/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * Notificaciones de aprobaciones de OV: destinatarios por etapa y cola de envíos.
 * Biblioteca compartida. No requiere despliegue individual.
 *
 * Importante: la preparación de destinatarios es una fotografía de la matriz
 * al momento de la acción. El Scheduled Script envía después sin recalcularla.
 */
define(['N/record', 'N/search', 'N/email', 'N/url', 'N/log', 'N/runtime',
        './FUT_MD_configAprobaciones', './FUT_MD_motorAprobaciones',
        './FUT_MD_historialAprobaciones'],
    (record, search, email, url, log, runtime, C, M, H) => {

    const EVENT_TYPE = 'customrecord_fut_apr_evento';
    const PAYLOAD = 'custrecord_fut_evt_dest';
    const STATUS = 'custrecord_fut_evt_notif';
    const MAX_RECIPIENTS = 10;
    const MAX_EVENTS = 30;

    const uniq = arr => [...new Set((arr || []).map(String)
        .filter(id => /^\d+$/.test(id) && Number(id) > 0))];
    const val = (rec, key) => rec.getValue({fieldId: key});
    const rule = code => M.RULES.find(r => String(r.code) === String(code));

    function grupo(clase, code, level, recipients, detalle) {
        const ids = uniq(recipients);
        if (!ids.length) return null;
        const r = rule(code);
        return {
            clase, condicion: code ? String(code) : '',
            nombre: r ? r.name : String(code || ''),
            nivel: Number(level) || 0, destinatarios: ids,
            enviados: [], detalle: String(detalle || '')
        };
    }

    function destinatarios(rec, cfg, code, level) {
        const subsidiary = val(rec, 'subsidiary');
        if (!subsidiary || !code || !level) return [];
        const m = M.matrix(String(code), subsidiary, cfg);
        const match = m.find(x => x.level === Number(level));
        return match ? uniq(match.users) : [];
    }

    // Destinatarios de una nueva solicitud (solo la siguiente etapa).
    function solicitud(next, detalle) {
        if (!next || next.blocked || !next.rule || !next.users) return [];
        const g = grupo('SOLICITUD', next.rule.code, next.level,
            next.users, detalle || 'Se requiere su autorización.');
        return g ? [g] : [];
    }

    // Confirmar a los miembros del nivel que acaba de autorizar o rechazar.
    function resultado(rec, cfg, code, level, detalle) {
        const g = grupo('RESULTADO', code, level,
            destinatarios(rec, cfg, code, level), detalle);
        return g ? [g] : [];
    }

    // Para cierre: última etapa intervenida del ciclo vigente. Si todavía no
    // hubo aprobaciones, se utiliza la primera etapa pendiente. Si se rechazó,
    // se toma la última condición rechazada. La etapa se fotografía antes de
    // cambiar el historial a 'closed'.
    function ultimaMatriz(rec, cfg, hist) {
        const candidates = [];
        const rank = (code, level) =>
            M.RULES.findIndex(r => String(r.code) === String(code)) * 10 + Number(level);
        Object.keys(hist.done || {}).forEach(code => {
            Object.keys(hist.done[code] || {}).forEach(level => {
                const a = hist.done[code][level];
                if (a && a.at) candidates.push({code, level: Number(level), at: String(a.at),
                        secuencia: rank(code, level)});
            });
        });
        const rejections = hist.rejections || [];
        // Un rechazo reinicia el historial done. Su nivel se conserva
        // explícitamente desde esta versión en el motor.
        rejections.forEach(r => {
            // No recuperar un rechazo de un ciclo anterior al cerrar una OV
            // que ya fue corregida y se encuentra en un ciclo nuevo.
            const sameCycle = Number(r && r.cycle || 1) === Number(hist.cycle || 1);
            if (sameCycle && r && r.at && r.condition) {
                candidates.push({code: String(r.condition),
                    level: Number(r.level) || 1, at: String(r.at),
                    secuencia: 1000 + rank(r.condition, r.level || 1)});
            }
        });
        candidates.sort((a, b) => b.at.localeCompare(a.at) || b.secuencia - a.secuencia);
        if (candidates.length) {
            const x = candidates[0];
            return grupo('CIERRE', x.code, x.level,
                destinatarios(rec, cfg, x.code, x.level),
                'La orden fue cerrada definitivamente.');
        }
        const pending = M.nextStage(rec, cfg, hist);
        if (pending && !pending.blocked && pending.rule) {
            return grupo('CIERRE', pending.rule.code, pending.level, pending.users,
                'La orden fue cerrada definitivamente sin autorizaciones previas.');
        }
        return null;
    }

    const escapeHtml = value => String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function nombreOrden(id) {
        try {
            const x = search.lookupFields({type: search.Type.SALES_ORDER,
                id: Number(id), columns: ['tranid']});
            return String(x.tranid || id);
        } catch (e) {
            log.error({title: 'Notificación: número de OV no disponible',
                details: String(e.message || e)});
            return String(id);
        }
    }

    function enlaceOrden(id) {
        try {
            const domain = url.resolveDomain({hostType: url.HostType.APPLICATION,
                accountId: runtime.accountId});
            const path = url.resolveRecord({recordType: 'salesorder',
                recordId: Number(id), isEditMode: false});
            return 'https://' + domain + path;
        } catch (e) {
            log.error({title: 'Enlace de orden no disponible', details: String(e.message || e)});
            return '';
        }
    }

    // Plantillas sobrias y adaptables a clientes de correo tradicionales.
    // Se evita mostrar códigos, campos internos o mensajes técnicos.
    const compactar = texto => String(texto === null || texto === undefined ? '' : texto)
        .replace(/\s+/g, ' ').trim();

    function cambiosDetectados(detalle) {
        const match = compactar(detalle).match(/Cambios detectados:\s*([^.]+)/i);
        return match ? compactar(match[1]) : '';
    }

    function motivoDelEvento(evento, envio) {
        const texto = compactar(evento.motivo);
        if (texto) return texto;
        // Compatibilidad con eventos de rechazo/cierre anteriores al diseño HTML.
        const anterior = compactar(envio.detalle || evento.detalle);
        const idx = anterior.lastIndexOf('Motivo:');
        if (idx < 0) return '';
        return anterior.slice(idx + 'Motivo:'.length).trim()
            .replace(/\.\s*$/, '').trim();
    }

    function filaCorreo(etiqueta, contenido) {
        if (contenido === null || contenido === undefined || contenido === '') return '';
        return '<tr><td valign="top" style="padding:11px 14px 11px 0;' +
            'border-bottom:1px solid #e5e8eb;color:#58636d;font-size:13px;' +
            'width:174px;vertical-align:top">' + escapeHtml(etiqueta) + '</td>' +
            '<td valign="top" style="padding:11px 0;border-bottom:1px solid #e5e8eb;' +
            'color:#252e36;font-size:14px;font-weight:600;vertical-align:top">' +
            escapeHtml(contenido) + '</td></tr>';
    }

    function mensaje(evento, envio, ref, orden) {
        const tipo = compactar(evento.tipo);
        const esSolicitud = envio.clase === 'SOLICITUD';
        const esCierre = envio.clase === 'CIERRE' || tipo === 'CIERRE';
        const esRechazo = !esCierre && tipo === 'RECHAZO';
        const esReaprobacion = esSolicitud && tipo === 'REAPROBACIÓN';
        const condicion = compactar(envio.nombre);
        const nivel = Number(envio.nivel) || 0;
        const etapa = condicion + (nivel ? ' (nivel ' + nivel + ')' : '');
        const ordenVisible = compactar(orden);
        const responsable = compactar(evento.usuario);
        const ciclo = Number(evento.ciclo) || 1;
        const motivo = motivoDelEvento(evento, envio);
        const cambios = esReaprobacion ? cambiosDetectados(evento.detalle) : '';

        let asunto, titulo, resumen, cierreTexto;
        if (esCierre) {
            asunto = 'Orden de venta cerrada | ' + ordenVisible;
            titulo = 'Cierre definitivo de orden de venta';
            resumen = 'La orden de venta fue cerrada de manera definitiva. ' +
                'Ya no es posible modificarla ni continuar con sus autorizaciones.';
            cierreTexto = 'Este correo es una confirmación del cierre. No se requiere ninguna acción adicional.';
        } else if (esSolicitud && esReaprobacion) {
            asunto = 'Reaprobación pendiente | ' + ordenVisible + ' | ' + etapa;
            titulo = 'Se requiere una nueva autorización';
            resumen = 'Se realizaron cambios comerciales en la orden y se reinició el ' +
                'proceso de aprobación. Esta etapa necesita revisarse nuevamente.';
            cierreTexto = 'Revise la orden de venta y registre su decisión desde la opción ' +
                'Aprobar o Rechazar.';
        } else if (esSolicitud) {
            asunto = 'Aprobación pendiente | ' + ordenVisible + ' | ' + etapa;
            titulo = 'Orden de venta pendiente de autorización';
            resumen = tipo === 'APROBACIÓN'
                ? 'La etapa anterior ya fue autorizada. Ahora corresponde revisar ' +
                    'la siguiente condición comercial.'
                : 'Esta orden de venta necesita su autorización para continuar ' +
                    'con el proceso.';
            cierreTexto = 'Revise la orden de venta y registre su decisión desde la opción ' +
                'Aprobar o Rechazar.';
        } else if (esRechazo) {
            asunto = 'Autorización rechazada | ' + ordenVisible + ' | ' + etapa;
            titulo = 'Se rechazó una autorización';
            resumen = 'Se registró un rechazo en el proceso de autorización de ' +
                'esta orden de venta. La orden podrá corregirse y enviarse nuevamente ' +
                'a aprobación.';
            cierreTexto = 'Este mensaje informa el resultado de la revisión.';
        } else {
            asunto = 'Autorización registrada | ' + ordenVisible + ' | ' + etapa;
            titulo = 'Autorización registrada';
            resumen = 'Se registró correctamente la autorización de esta condición ' +
                'comercial. La orden continuará con las etapas que correspondan.';
            cierreTexto = 'Este mensaje confirma la autorización realizada.';
        }
        // Limitar el asunto para evitar cortes impredecibles en dispositivos móviles.
        if (asunto.length > 170) asunto = asunto.slice(0, 167) + '...';

        let filas = filaCorreo('Orden de venta', ordenVisible);
        if (condicion) filas += filaCorreo('Condición comercial', condicion);
        if (nivel) filas += filaCorreo('Nivel de autorización', String(nivel));
        if (ciclo > 1) filas += filaCorreo('Ronda de aprobación', String(ciclo));
        if (responsable) filas += filaCorreo('Acción registrada por', responsable);
        if (esRechazo && motivo) filas += filaCorreo('Motivo del rechazo', motivo);
        if (esCierre && motivo) filas += filaCorreo('Motivo del cierre', motivo);
        if (esReaprobacion && cambios) filas += filaCorreo('Cambios identificados', cambios);

        const href = /^https:\/\//i.test(String(ref || ''))
            ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" ' +
                'style="margin:22px 0 5px"><tr><td style="border:1px solid #bac6cf;' +
                'background-color:#ffffff;padding:10px 15px">' +
                '<a href="' + escapeHtml(ref) + '" style="font-family:Arial,Helvetica,sans-serif;' +
                'font-size:14px;color:#1c5575;text-decoration:none;font-weight:600">' +
                (esSolicitud ? 'Revisar orden de venta' : 'Consultar orden de venta') +
                '</a></td></tr></table>'
            : '';
        const preheader = esSolicitud
            ? 'La orden ' + ordenVisible + ' está pendiente de su autorización.'
            : titulo + ': ' + ordenVisible;

        // Diseño limpio, similar a un formulario de NetSuite: fondo blanco,
        // tipografía estándar y líneas de separación, sin tarjetas ni rellenos.
        // Se usan tablas y estilos inline para compatibilidad con Outlook.
        const cuerpo = '<!doctype html><html lang="es"><head>' +
            '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>' + escapeHtml(titulo) + '</title></head>' +
            '<body style="margin:0;padding:0;background-color:#ffffff;' +
                'font-family:Arial,Helvetica,sans-serif;color:#252e36">' +
            '<div style="display:none;max-height:0;overflow:hidden;opacity:0;' +
                'mso-hide:all;color:#ffffff;font-size:1px;line-height:1px">' +
                escapeHtml(preheader) + '</div>' +
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
                'style="width:100%;background-color:#ffffff;border-collapse:collapse">' +
            '<tr><td align="center" style="padding:12px 18px 24px">' +
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="620" ' +
                'style="width:100%;max-width:620px;background-color:#ffffff;' +
                'border-collapse:collapse">' +
            '<tr><td style="padding:19px 6px 19px;border-bottom:1px solid #d8dee3">' +
                '<p style="margin:0 0 11px;font-size:11px;font-weight:600;' +
                'letter-spacing:0.4px;color:#566674">ÓRDENES DE VENTA · AUTORIZACIONES</p>' +
                '<h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;' +
                'font-weight:600;color:#273541">' + escapeHtml(titulo) + '</h1>' +
                '<p style="margin:0 0 10px;font-size:14px;line-height:1.6;' +
                'color:#2e3942">Buen día.</p>' +
                '<p style="margin:0;font-size:14px;line-height:1.65;color:#2e3942">' +
                escapeHtml(resumen) + '</p>' +
            '</td></tr>' +
            '<tr><td style="padding:12px 6px 3px"><table role="presentation" width="100%" ' +
                'cellpadding="0" cellspacing="0" border="0" ' +
                'style="width:100%;border-collapse:collapse">' + filas +
                '</table></td></tr>' +
            '<tr><td style="padding:5px 6px 24px">' + href +
                '<p style="margin:16px 0 0;font-size:13px;line-height:1.6;' +
                'color:#4e5b65">' + escapeHtml(cierreTexto) + '</p>' +
            '</td></tr>' +
            '<tr><td style="padding:15px 6px 8px;border-top:1px solid #d8dee3;' +
                'background-color:#ffffff">' +
                '<p style="margin:0;font-size:12px;line-height:1.55;color:#6a747d">' +
                'Notificación automática del proceso de autorizaciones. ' +
                'Para consultar el estado actualizado, abra la orden en NetSuite.' +
                '</p></td></tr>' +
            '</table></td></tr></table></body></html>';

        return {asunto, cuerpo};
    }

    // Si un envío tiene más de diez destinatarios, cada lote se confirma en
    // el historial; ENVIADO se establece solo cuando termina el evento.
    const MAX_MINUTOS_RECUPERACION = 90;

    function saveProgress(rec, doc, estado) {
        doc.ultimoAvance = new Date().toISOString();
        rec.setValue({fieldId: PAYLOAD, value: JSON.stringify(doc)});
        rec.setValue({fieldId: STATUS, value: H.opcionEstado(estado)});
        return rec.save({enableSourcing: false, ignoreMandatoryFields: false});
    }

    function parsePlan(rec, id) {
        const raw = String(val(rec, PAYLOAD) || '');
        let doc;
        try {
            doc = JSON.parse(raw);
            if (!doc || doc.version !== 1 || !Array.isArray(doc.envios)) {
                throw Error('Estructura del plan inválida.');
            }
        } catch (e) {
            // No intentar indefinidamente un evento con estructura inválida.
            try {
                rec.setValue({fieldId: STATUS, value: H.opcionEstado('ERROR')});
                rec.save({enableSourcing: false, ignoreMandatoryFields: false});
            } catch (ignore) {}
            log.error({title: 'Plan de correos inválido', details: JSON.stringify({
                evento: id, error: String(e.message || e)})});
            throw Error('No es posible leer los destinatarios del evento ' + id);
        }
        return doc;
    }

    function recuperable(doc) {
        const fecha = String(doc && doc.ultimoAvance || '');
        const fechaMs = Date.parse(fecha);
        return Number.isFinite(fechaMs) &&
            Date.now() - fechaMs > MAX_MINUTOS_RECUPERACION * 60000;
    }

    // Los dos despliegues pueden coincidir. Primero reclamamos el evento
    // cambiándolo a EN PROCESO y guardándolo. La opción Enable Optimistic
    // Locking del customrecord_fut_apr_evento DEBE permanecer habilitada:
    // de lo contrario ambos procesadores podrían tomar el mismo evento.
    function claim(id) {
        const rec = record.load({type: EVENT_TYPE, id: Number(id), isDynamic: false});
        const estado = String(val(rec, STATUS));
        const pendiente = String(H.opcionEstado('PENDIENTE'));
        const procesando = String(H.opcionEstado('EN PROCESO'));
        if (estado !== pendiente && estado !== procesando) return null;
        const doc = parsePlan(rec, id);
        if (estado === procesando && !recuperable(doc)) return null;
        if (estado === procesando) {
            // Si se interrumpió entre la solicitud de envío y el guardado,
            // no sabemos si NetSuite aceptó ese lote. NO reenviarlo solo.
            if (doc.loteActual && doc.loteActual.destinatarios) {
                doc.ultimoError = 'Lote con resultado incierto. Revisar correos enviados ' +
                    'antes de volver a procesar este evento.';
                doc.control = null;
                try { saveProgress(rec, doc, 'ERROR'); }
                catch (e) { log.error({title: 'No se pudo marcar lote incierto',
                    details: String(e.message || e)}); }
                return null;
            }
            log.audit({title: 'Recuperando ejecución interrumpida',
                details: JSON.stringify({evento: Number(id),
                    ultimoAvance: doc.ultimoAvance || ''})});
        }
        doc.control = {
            tomado: new Date().toISOString(),
            scriptId: String(runtime.getCurrentScript().id || ''),
            deploymentId: String(runtime.getCurrentScript().deploymentId || '')
        };
        try {
            saveProgress(rec, doc, 'EN PROCESO');
        } catch (e) {
            // Un conflicto por Optimistic Locking indica que otro worker
            // tomó el evento; jamás debemos enviar sin completar el claim.
            log.audit({title: 'Evento tomado por otra ejecución',
                details: JSON.stringify({evento: Number(id),
                    error: String(e.message || e)})});
            return null;
        }
        // Recargar tras save para continuar con la versión de registro actual.
        // Es importante con Enable Optimistic Locking activo.
        return {rec: record.load({type: EVENT_TYPE, id: Number(id),
            isDynamic: false}), doc};
    }

    function processOne(id) {
        const lock = claim(id);
        if (!lock) return 'OMITIDO';
        let rec = lock.rec;
        const doc = lock.doc;
        try {
        const evento = {
            tipo: rec.getText({fieldId: 'custrecord_fut_evt_tipo'}) || '',
            ciclo: val(rec, 'custrecord_fut_evt_ciclo'),
            usuario: rec.getText({fieldId: 'custrecord_fut_evt_usuario'}) || '',
            detalle: val(rec, 'custrecord_fut_evt_detalle') || '',
            motivo: ''
        };
        try {
            evento.motivo = String(rec.getText({fieldId: 'custrecord_fut_evt_motivo'}) || '');
        } catch (e) {
            // La notificación sigue disponible aunque no se pueda mostrar
            // el nombre de un motivo en un evento histórico.
            log.audit({title: 'Motivo no disponible para correo',
                details: String(e.message || e)});
        }
        const actor = Number(val(rec, 'custrecord_fut_evt_usuario'));
        const soId = Number(val(rec, 'custrecord_fut_evt_ov'));
        if (!(actor > 0) || !(soId > 0)) {
            throw Error('El historial no tiene empleado remitente u orden de venta válidos.');
        }
        const orden = nombreOrden(soId);
        const link = enlaceOrden(soId);
        // Verificar vigencia de las solicitudes y resultados antes de enviar.
        // Un evento del historial conserva la evidencia de una aprobación,
        // pero no debe notificarla como vigente si se reinició su ciclo.
        let etapaVigente = null;
        let histActual = null;
        let estadoActual = null;
        const requiereValidacion = doc.envios.some(x =>
            x.clase === 'SOLICITUD' || x.clase === 'RESULTADO');
        if (requiereValidacion) {
            const current = record.load({type: record.Type.SALES_ORDER,
                id: soId, isDynamic: false});
            histActual = M.readHistory(current);
            estadoActual = String(val(current, 'orderstatus') || '');
            if (doc.envios.some(x => x.clase === 'SOLICITUD') &&
                histActual.state === 'active' && estadoActual === 'A' &&
                !M.isOn(val(current, 'custbody_fut_cerrada'))) {
                etapaVigente = M.nextStage(current, C.get(), histActual);
            }
        }
        for (const envio of doc.envios) {
            envio.enviados = uniq(envio.enviados);
            const mismoCiclo = histActual &&
                Number(evento.ciclo) === Number(histActual.cycle);
            if (envio.clase === 'SOLICITUD') {
                const vigente = mismoCiclo && etapaVigente &&
                    !etapaVigente.blocked && etapaVigente.rule &&
                    String(etapaVigente.rule.code) === String(envio.condicion) &&
                    Number(etapaVigente.level) === Number(envio.nivel);
                if (!vigente) {
                    envio.omitido = true;
                    envio.motivoOmision = 'La orden ya no está en esta etapa de aprobación.';
                    continue;
                }
            }
            if (envio.clase === 'RESULTADO' && evento.tipo === 'APROBACIÓN') {
                const autorizado = mismoCiclo &&
                    ['active', 'approved'].includes(String(histActual.state)) &&
                    histActual.done &&
                    histActual.done[String(envio.condicion)] &&
                    histActual.done[String(envio.condicion)][String(envio.nivel)];
                if (!autorizado) {
                    envio.omitido = true;
                    envio.motivoOmision = 'La autorización pertenece a un ciclo anterior o fue reiniciada.';
                    continue;
                }
            }
            if (envio.clase === 'RESULTADO' && evento.tipo === 'RECHAZO') {
                const rechazoVigente = mismoCiclo &&
                    histActual.state === 'rejected' &&
                    (histActual.rejections || []).some(r =>
                        Number(r.cycle || 1) === Number(evento.ciclo) &&
                        String(r.condition) === String(envio.condicion) &&
                        Number(r.level) === Number(envio.nivel));
                if (!rechazoVigente) {
                    envio.omitido = true;
                    envio.motivoOmision = 'El rechazo ya no corresponde al ciclo vigente.';
                    continue;
                }
            }
            const pending = uniq(envio.destinatarios).filter(x => !envio.enviados.includes(x));
            const msg = mensaje(evento, envio, link, orden);
            for (let n = 0; n < pending.length; n += MAX_RECIPIENTS) {
                const chunk = pending.slice(n, n + MAX_RECIPIENTS);
                // No iniciar un nuevo lote si la ejecución está cerca del límite.
                // Se liberará al estado PENDIENTE para que el respaldo continúe
                // usando la lista de enviados ya registrada.
                if (runtime.getCurrentScript().getRemainingUsage() < 130) {
                    doc.control = null;
                    saveProgress(rec, doc, 'PENDIENTE');
                    log.audit({title: 'Envío parcial reprogramable',
                        details: JSON.stringify({evento: Number(id),
                            enviados: doc.envios.map(g => (g.enviados || []).length)})});
                    return 'PARCIAL';
                }
                // Guardar ANTES de enviar qué bloque está en trámite.
                // Si el worker se interrumpe en medio, se marcará ERROR
                // para revisión manual y no duplicará automáticamente correos.
                doc.loteActual = {
                    destinatarios: chunk,
                    condicion: envio.condicion,
                    nivel: envio.nivel,
                    clase: envio.clase,
                    inicio: new Date().toISOString()
                };
                saveProgress(rec, doc, 'EN PROCESO');
                rec = record.load({type: EVENT_TYPE, id: Number(id),
                    isDynamic: false});
                try {
                    email.send({
                        author: actor,
                        recipients: chunk.map(Number),
                        subject: msg.asunto,
                        body: msg.cuerpo,
                        relatedRecords: {transactionId: soId}
                    });
                } catch (e) {
                    throw Error('No se pudo enviar el evento ' + id +
                        ': ' + String(e.message || e));
                }
                envio.enviados.push(...chunk);
                doc.loteActual = null;
                doc.ultimoError = '';
                // Esta actualización confirma a qué destinatarios se aceptó
                // el envío; no confirma que ya llegó a su buzón.
                saveProgress(rec, doc, 'EN PROCESO');
                rec = record.load({type: EVENT_TYPE, id: Number(id),
                    isDynamic: false});
            }
        }

        doc.finalizado = new Date().toISOString();
        doc.control = null;
        const hayDestinatariosEnviados = doc.envios.some(
            x => (x.enviados || []).length > 0);
        saveProgress(rec, doc, hayDestinatariosEnviados ? 'ENVIADO' : 'NO APLICA');
        log.audit({title: 'Evento de correo completado', details: JSON.stringify({
            eventoId: Number(id), ordenId: soId,
            grupos: doc.envios.length,
            enviados: doc.envios.map(g => (g.enviados || []).length),
            omitidos: doc.envios.filter(g => g.omitido).length
        })});
        return 'FINALIZADO';
        } catch (e) {
            // El evento permanece consultable como ERROR, conservando la
            // lista de destinatarios a los que ya se envió un correo.
            doc.ultimoError = String(e.message || e);
            doc.ultimoIntento = new Date().toISOString();
            doc.control = null;
            try { saveProgress(rec, doc, 'ERROR'); }
            catch (saveError) {
                log.error({title: 'No fue posible guardar el error de notificación',
                    details: JSON.stringify({evento: Number(id),
                        mensaje: String(saveError.message || saveError)})});
            }
            throw e;
        }
    }

    function procesarCola() {
        const pendiente = String(H.opcionEstado('PENDIENTE'));
        const procesando = String(H.opcionEstado('EN PROCESO'));
        // Prioridad para eventos nuevos PENDIENTE; después únicamente
        // examinamos posibles ejecuciones interrumpidas EN PROCESO.
        function buscar(estado, limite) {
            if (limite <= 0) return [];
            return search.create({type: EVENT_TYPE,
                filters: [[STATUS, 'anyof', estado]],
                columns: [search.createColumn({name: 'internalid', sort: search.Sort.ASC})]
            }).run().getRange({start: 0, end: limite}) || [];
        }
        const rows = buscar(pendiente, MAX_EVENTS);
        rows.push(...buscar(procesando, MAX_EVENTS - rows.length));
        let correctos = 0, parciales = 0, omitidos = 0, fallidos = 0;
        for (const row of rows) {
            if (runtime.getCurrentScript().getRemainingUsage() < 180) break;
            try {
                const resultado = processOne(row.id);
                if (resultado === 'FINALIZADO') correctos++;
                else if (resultado === 'PARCIAL') parciales++;
                else omitidos++;
            } catch (e) {
                fallidos++;
                log.error({title: 'Error en correo de OV',
                    details: JSON.stringify({evento: row.id,
                        error: String(e.message || e)})});
            }
        }
        log.audit({title: 'Resumen de notificaciones',
            details: JSON.stringify({consultados: rows.length, correctos,
                parciales, omitidos, fallidos})});
        return {consultados: rows.length, correctos, parciales, omitidos, fallidos};
    }

    return {solicitud, resultado, ultimaMatriz, destinatarios, procesarCola,
        processOne, grupo, crearMensaje: mensaje};
});

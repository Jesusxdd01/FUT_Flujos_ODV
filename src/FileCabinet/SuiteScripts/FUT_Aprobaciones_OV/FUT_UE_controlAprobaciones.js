/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * FUT | Condiciones, aprobaciones, historial y cierre definitivo.
 * Script: customscript_fut_ue_ordenAprob
 * Deploy: customdeploy_fut_ue_ordenAprob
 */
define(['N/record', 'N/runtime', 'N/error', 'N/log', 'N/ui/message', 'N/ui/serverWidget', 'N/search',
        './FUT_MD_configAprobaciones', './FUT_MD_motorAprobaciones',
        './FUT_MD_historialAprobaciones', './FUT_MD_cierreOV',
        './FUT_MD_notificaciones', './FUT_MD_dispararNotificaciones'],
    (record, runtime, error, log, message, serverWidget, search, C, M, H, Close, N, T) => {

    const F = C.F;
    const eq = (a, b) => String(a === null || a === undefined ? '' : a) ===
        String(b === null || b === undefined ? '' : b);
    const is = (ctx, which) => ctx.type === ctx.UserEventType[which];
    const nonTender = rec => !M.isOn(rec.getValue({fieldId: 'custbody_licitacion'}));
    const controlled = (rec, cfg) => nonTender(rec) && C.applies(rec, cfg, 'initial');
    const reapproval = (rec, cfg) => nonTender(rec) && C.applies(rec, cfg, 'reapprove');
    const value = (rec, id) => rec.getValue({fieldId: id});

    // Sin matrices: todo usuario con acceso a la OV puede aprobar desde el botón FUT.
    // Las licitaciones conservan su flujo independiente.
    function aprobacionGeneral(rec, cfg) {
        return nonTender(rec) &&
            (!controlled(rec, cfg) || M.checked(rec).length === 0);
    }

    function iniciarAprobacionGeneral(rec, h) {
        h.state = 'active';
        h.generalApproval = {
            state: 'pending',
            requestedAt: new Date().toISOString()
        };
        M.writeHistory(rec, h);
        rec.setValue({fieldId: 'orderstatus', value: 'A'});
        rec.setValue({fieldId: F.next, value: []});
        rec.setValue({fieldId: F.level, value: null});
    }


    function nativeBlocked(rec) {
        const tranid = value(rec, 'tranid') || rec.id || '';
        throw error.create({
            name: 'APROBACION_COMERCIAL_REQUERIDA', notifyOff: true,
            message: 'La orden ' + tranid + ' requiere aprobación comercial. ' +
                'No es posible autorizarla desde esta lista. ' +
                'Abra la orden y utilice el botón Aprobar.'
        });
    }
    function closedBlocked() {
        C.fail('Esta orden de venta está cerrada definitivamente. ' +
            'No es posible editarla, aprobarla, reabrirla ni eliminarla.');
    }
    function loadCurrent(id) {
        return record.load({type: record.Type.SALES_ORDER, id, isDynamic: false});
    }

    // Restricción de cambio de cliente en los formularios excluidos de CONFIG_UNICA.
    // El perfil protegido usa lockTerms y lockPrice, no baseTerms ni basePrice.
    // Se compara por IDs internos configurados, no por etiquetas.
    // Se evalúa únicamente el cliente previamente guardado en la OV.
    const MSG_MOSTRADOR =
        'Para evitar inconsistencias con las transacciones relacionadas, ' +
        'deberá realizar el proceso de devolución, cierre y creación ' +
        'de una nueva orden de venta.';

    function idCampoSeleccion(valor) {
        if (Array.isArray(valor)) {
            return valor.length ? idCampoSeleccion(valor[0]) : '';
        }
        if (valor && typeof valor === 'object') {
            return String(valor.value || '');
        }
        return String(valor || '');
    }

    function clienteEsPerfilMostrador(clienteId, cfg) {
        // Sin cliente o sin ambos criterios protegidos, no se aplica la restricción.
        if (!clienteId || !cfg.lockTerms || !cfg.lockPrice) return false;
        const datos = search.lookupFields({
            type: search.Type.CUSTOMER,
            id: clienteId,
            columns: ['terms', 'pricelevel']
        });
        const terminosId = idCampoSeleccion(datos.terms);
        const precioId = idCampoSeleccion(datos.pricelevel);
        return !!terminosId && !!precioId &&
            terminosId === cfg.lockTerms &&
            precioId === cfg.lockPrice;
    }

    function excluido(rec, cfg) {
        return cfg.excluded.includes(String(value(rec, 'customform') || ''));
    }

    function validarCambioClienteMostrador(ctx, anterior, cfg) {
        // CREATE no tiene cliente previamente guardado: no aplica la restricción.
        if (!anterior || !(is(ctx, 'EDIT') || is(ctx, 'XEDIT'))) return;
        // XEDIT puede incluir solamente los campos modificados.
        if (is(ctx, 'XEDIT') && !ctx.newRecord.getFields().includes('entity')) return;

        const clienteAntes = value(anterior, 'entity');
        const clienteAhora = value(ctx.newRecord, 'entity');
        if (eq(clienteAntes, clienteAhora)) return;

        // Se considera el formulario anterior o el nuevo para que no pueda
        // omitirse la restricción cambiando formulario y cliente a la vez.
        // En XEDIT, si customform no viene en el registro parcial, se usa el anterior.
        if (!excluido(anterior, cfg) && !excluido(ctx.newRecord, cfg)) return;

        // Sólo importa el cliente ANTERIOR. No consultar ni evaluar el nuevo.
        if (clienteEsPerfilMostrador(clienteAntes, cfg)) {
            C.fail(MSG_MOSTRADOR);
        }
    }

    function beforeLoad(ctx) {
        // El Client Script se instala desde la edición para impedir que cambiar
        // formulario y cliente en una misma sesión eluda la validación visual.
        // El bloqueo definitivo se ejecuta en beforeSubmit.
        if (is(ctx, 'EDIT')) {
            if (!ctx.newRecord.id) return;
            const cfg = C.get();
            if (!cfg.excluded.length) return;
            const rec = loadCurrent(ctx.newRecord.id);
            if (!clienteEsPerfilMostrador(value(rec, 'entity'), cfg)) return;

            function campoOculto(id, etiqueta, contenido) {
                const f = ctx.form.addField({
                    id, type: serverWidget.FieldType.TEXT, label: etiqueta
                });
                f.defaultValue = String(contenido || '');
                f.updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN});
            }
            // Estos campos también son consumidos por saveRecord del Client Script.
            // No usar el cliente en pantalla como referencia: NetSuite puede
            // modificarlo por sourcing al cambiar de formulario.
            campoOculto('custpage_fut_cliente_original', 'Cliente original FUT',
                value(rec, 'entity'));
            campoOculto('custpage_fut_form_original', 'Formulario original FUT',
                value(rec, 'customform'));
            campoOculto('custpage_fut_forms_excluidos', 'Formularios excluidos FUT',
                cfg.excluded.join(','));

            ctx.form.clientScriptModulePath = './FUT_CS_accionesAprobacion.js';
            // El aviso aparece solamente si la OV ya usa un formulario excluido.
            // La comprobación definitiva protege también el cambio simultáneo
            // de formulario y cliente en beforeSubmit.
            if (excluido(rec, cfg)) {
                ctx.form.addPageInitMessage({
                    type: message.Type.WARNING,
                    title: 'No es posible modificar el cliente',
                    message: MSG_MOSTRADOR,
                    duration: 0
                });
            }
            return;
        }
        if (!is(ctx, 'VIEW')) return;
        const cfg = C.get();
        // En esta cuenta customform no está disponible en ctx.newRecord en VIEW.
        const rec = loadCurrent(ctx.newRecord.id);
        const aplica = controlled(rec, cfg);

        // La orden controlada utiliza exclusivamente el botón personalizado
        // Cerrar. Evitar que se ejecute el cierre estándar, que no registra
        // motivo ni activa el indicador de cierre definitivo.
        if (aplica) {
            try {
                ctx.form.removeButton({id: 'closeremaining'});
            } catch (e) {
                log.debug({title: 'Cierre estándar no disponible para ocultar',
                    details: String(e.message || e)});
            }
        }

        if (Close.isClosed(rec)) {
            ctx.form.addPageInitMessage({
                type: message.Type.WARNING,
                title: 'Orden cerrada definitivamente',
                message: 'Esta orden está cerrada definitivamente. ' +
                    'No es posible editarla ni continuar con sus autorizaciones.',
                duration: 0
            });
            // El botón Editar no puede eliminarse de forma soportada desde
            // SuiteScript. beforeSubmit impide guardar modificaciones.
            try { ctx.form.removeButton({id: 'approve'}); } catch (e) {}
            return;
        }
        const general = aprobacionGeneral(rec, cfg);
        if (!aplica && !general) return;
        const status = String(value(rec, 'orderstatus') || '');
        if (status !== 'A' && status !== 'B') return;

        ctx.form.clientScriptModulePath = './FUT_CS_accionesAprobacion.js';
        if (status === 'A') {
            if (general) {
                // También cubre OV antiguas devueltas manualmente a Pendiente.
                try { ctx.form.removeButton({id: 'approve'}); } catch (e) {}
                ctx.form.addButton({
                    id: 'custpage_fut_aprobar', label: 'Aprobar',
                    functionName: 'futAprobar(' + Number(rec.id) + ')'
                });
            } else {
                const hist = M.readHistory(rec);
                const next = M.nextStage(rec, cfg, hist);
                if (next && next.blocked) {
                    ctx.form.addPageInitMessage({
                        type: message.Type.WARNING,
                        title: hist.state === 'rejected' ? 'Edición pendiente' :
                            'Configuración de aprobación pendiente',
                        message: next.reason,
                        duration: 10000
                    });
                } else if (next && next.users.includes(String(runtime.getCurrentUser().id))) {
                    ctx.form.addButton({
                        id: 'custpage_fut_aprobar', label: 'Aprobar',
                        functionName: 'futAprobar(' + Number(rec.id) + ')'
                    });
                    ctx.form.addButton({
                        id: 'custpage_fut_rechazar', label: 'Rechazar',
                        functionName: 'futRechazar(' + Number(rec.id) + ')'
                    });
                }
            }
        }
        if (!aplica) return;
        // Botón al final únicamente si no ha comenzado surtido o facturación.
        // La validación se vuelve a ejecutar al abrir y enviar el Suitelet.
        let cierreDisponible = false;
        try {
            Close.validate(rec, cfg);
            cierreDisponible = Close.usuarioPuedeCerrar(
                rec, cfg, runtime.getCurrentUser().id);
        }
        catch (e) { log.audit({title: 'Cierre no disponible',
            details: JSON.stringify({orden: rec.id, motivo: String(e.message || e)})}); }
        if (cierreDisponible) {
            ctx.form.addButton({
                id: 'custpage_fut_cerrar', label: 'Cerrar',
                functionName: 'futCerrar(' + Number(rec.id) + ')'
            });
        }
    }

    function beforeSubmit(ctx) {
        const rec = ctx.newRecord;
        const old = ctx.oldRecord;
        const event = ctx.type;

        // El candado FUT se verifica ANTES de la configuración, formulario y
        // validaciones ordinarias para proteger todas las rutas de edición.
        // XEDIT entrega registros parciales: se consulta el registro persistido.
        let prior = old;
        if (!is(ctx, 'CREATE') && rec.id && (is(ctx, 'XEDIT') || !prior)) {
            prior = loadCurrent(rec.id);
        }
        if (prior && Close.isClosed(prior)) closedBlocked();

        if (is(ctx, 'DELETE')) return;

        if (is(ctx, 'CREATE')) {
            // Una copia de OV cerrada no debe heredar el candado definitivo.
            if (Close.isClosed(rec)) rec.setValue({fieldId: Close.LOCK, value: false});
        }
        if (is(ctx, 'XEDIT') && rec.getFields().includes(Close.LOCK)) {
            C.fail('El indicador de cierre definitivo sólo se administra desde el botón Cerrar OV.');
        }

        // Aplicar la restricción SOLO a formularios excluidos configurados.
        // El cliente anterior se obtiene de oldRecord o del registro persistido
        // en XEDIT; funciona sin importar el rol del usuario.
        const cfg = C.get();
        validarCambioClienteMostrador(ctx, prior, cfg);
        if (Close.isClosed(rec)) {
            // Sólo el Suitelet puede ejecutar la transición FALSE -> TRUE.
            if (!is(ctx, 'EDIT') || runtime.executionContext !== runtime.ContextType.SUITELET) {
                C.fail('El cierre definitivo debe realizarse desde el botón ' +
                    'Cerrar de la orden de venta.');
            }
            // Revalidar incluso si otra Suitelet intentara marcar el candado.
            if (!prior) C.fail('No se pudo verificar el estado anterior de la orden.');
            Close.exigirAprobador(prior, cfg, runtime.getCurrentUser().id);
            Close.validate(prior, cfg);
            return;
        }

        if (is(ctx, 'APPROVE') || is(ctx, 'REJECT')) {
            const base = prior || old || rec;
            // No se permite omitir el historial FUT mediante la aprobación nativa.
            if (aprobacionGeneral(base, cfg) ||
                (controlled(base, cfg) && M.checked(base).length)) nativeBlocked(base);
            return;
        }
        if (is(ctx, 'XEDIT')) {
            const stored = prior || loadCurrent(rec.id);
            if (aprobacionGeneral(stored, cfg) &&
                rec.getFields().includes('orderstatus')) {
                C.fail('Apruebe desde el botón Aprobar de la orden de venta.');
            }
            if (!controlled(stored, cfg) && !reapproval(stored, cfg)) return;
            const unsafe = new Set(['entity', 'total', 'customform', 'orderstatus',
                F.history, F.level, F.next]
                .concat(M.RULES.map(r => r.condition))
                .concat(M.RULES.flatMap(r => [r.approved].concat(r.first ? [r.first] : []))));
            if (rec.getFields().some(id => unsafe.has(id))) C.fail(
                'La edición en línea de cliente, importes, formularios o campos ' +
                'de aprobación no está permitida. Abra la OV en edición completa.');
            return;
        }
        if (!is(ctx, 'CREATE') && !is(ctx, 'EDIT')) return;

        // Evita liberar manualmente una OV que requiere aprobación general.
        if (is(ctx, 'EDIT') && prior &&
            String(value(prior, 'orderstatus') || '') === 'A' &&
            String(value(rec, 'orderstatus') || '') === 'B' &&
            aprobacionGeneral(prior, cfg)) {
            const h = M.readHistory(rec);
            const cambioHistorial = !eq(value(prior, F.history), value(rec, F.history));
            const valido = runtime.executionContext === runtime.ContextType.SUITELET &&
                cambioHistorial && h.state === 'approved' &&
                h.generalApproval && h.generalApproval.state === 'approved' &&
                !!h.generalApproval.by;
            if (!valido) C.fail('Para liberar esta orden utilice el botón Aprobar de FUT.');
        }

        const nowInit = controlled(rec, cfg);
        const nowReap = reapproval(rec, cfg);
        const previouslyControlled = old && (controlled(old, cfg) || reapproval(old, cfg));
        if (previouslyControlled && !nowInit && !nowReap) C.fail(
            'No se permite cambiar esta orden a un formulario fuera del proceso de autorización ' +
            'mediante edición ordinaria. Consulte al administrador.');
        const create = is(ctx, 'CREATE');

        // Las OV fuera de las matrices se crean pendientes, aunque tengan checks activos.
        if (create && !nowInit) {
            if (aprobacionGeneral(rec, cfg)) {
                const h = M.resetApprovals(rec, M.blankHistory(), true);
                iniciarAprobacionGeneral(rec, h);
            }
            return;
        }

        // Permite reiniciar el ciclo si una OV general ya liberada vuelve a Pendiente.
        if (!create && prior &&
            String(value(prior, 'orderstatus') || '') === 'B' &&
            String(value(rec, 'orderstatus') || '') === 'A' &&
            aprobacionGeneral(rec, cfg)) {
            const h = M.resetApprovals(rec, M.readHistory(prior), false);
            iniciarAprobacionGeneral(rec, h);
            return;
        }

        if (!nowInit && !nowReap) return;
        const changed = create || (old && nowReap && M.changed(old, rec, false));
        if (changed) {
            const previous = create ? M.blankHistory() : M.readHistory(rec);
            M.resetApprovals(rec, previous, create);
            // Las condiciones comerciales se calculan únicamente para los
            // formularios que entran al flujo de matrices.
            if (nowInit) M.refreshConditions(rec, cfg);
            if (aprobacionGeneral(rec, cfg)) {
                iniciarAprobacionGeneral(rec, M.readHistory(rec));
            } else {
                M.sync(rec, cfg, M.readHistory(rec));
            }
            log.audit({title: 'FUT Inicio/Reaprobación', details: JSON.stringify({
                id: rec.id || null, tranid: value(rec, 'tranid'), evento: event,
                ciclo: M.readHistory(rec).cycle, form: value(rec, 'customform'),
                condiciones: M.checked(rec).map(x => x.code),
                modo: aprobacionGeneral(rec, cfg) ? 'GENERAL' : 'MATRICES'
            })});
            return;
        }
        if (!old || !nowInit) return;
        const fromApprovalService = runtime.executionContext === runtime.ContextType.SUITELET;
        const historyChanged = !eq(value(old, F.history), value(rec, F.history));
        const approvalFields = M.RULES.flatMap(r =>
            [r.approved].concat(r.first ? [r.first] : []))
            .concat([F.level, F.next, F.reason]);
        const manualApprovalChange = approvalFields.some(fieldId =>
            !eq(value(old, fieldId), value(rec, fieldId)));
        if ((manualApprovalChange || historyChanged) &&
            !(fromApprovalService && historyChanged)) {
            C.fail('Los campos de autorización solo pueden modificarse ' +
                'mediante los botones Aprobar o Rechazar de la OV.');
        }
        const oldStatus = String(value(old, 'orderstatus') || '');
        const newStatus = String(value(rec, 'orderstatus') || '');
        if (oldStatus === 'A' && newStatus === 'B' && M.checked(rec).length &&
            !(fromApprovalService && historyChanged &&
                M.allDone(rec, cfg, M.readHistory(rec)))) {
            C.fail('No se puede liberar la orden: faltan validaciones del ' +
                'proceso comercial. Apruebe desde la propia orden.');
        }
    }

    // Únicamente para describir el correo de reaprobación.
    // No modifica qué cambios disparan el reinicio: esa regla permanece
    // centralizada en M.changed() y conserva el comportamiento aprobado.
    function resumenCamposEditados(anterior, actual) {
        const cambios = [];
        const agregar = etiqueta => {
            if (!cambios.includes(etiqueta)) cambios.push(etiqueta);
        };
        const normalizar = v => v === null || v === undefined ? '' : String(v).trim();
        const diferentes = (a, b) => normalizar(a) !== normalizar(b);
        try {
            if (diferentes(value(anterior, 'entity'), value(actual, 'entity'))) {
                agregar('cliente');
            }
            if (diferentes(value(anterior, 'total'), value(actual, 'total'))) {
                agregar('importe total');
            }
            if (M.RULES.some(r => diferentes(value(anterior, r.condition),
                    value(actual, r.condition)))) {
                agregar('condiciones comerciales');
            }
            const antes = anterior.getLineCount({sublistId: 'item'});
            const despues = actual.getLineCount({sublistId: 'item'});
            if (antes !== despues) {
                agregar('líneas de artículos');
            } else {
                const camposLinea = [
                    {id: 'item', texto: 'artículos'},
                    {id: 'quantity', texto: 'cantidades'},
                    {id: 'rate', texto: 'precios unitarios'},
                    {id: 'price', texto: 'niveles de precio'},
                    {id: 'amount', texto: 'importes de líneas'}
                ];
                for (const campo of camposLinea) {
                    for (let linea = 0; linea < despues; linea++) {
                        const antesVal = anterior.getSublistValue({
                            sublistId: 'item', fieldId: campo.id, line: linea
                        });
                        const despuesVal = actual.getSublistValue({
                            sublistId: 'item', fieldId: campo.id, line: linea
                        });
                        if (diferentes(antesVal, despuesVal)) {
                            agregar(campo.texto);
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            log.debug({title: 'Resumen de cambios no disponible',
                details: String(e.message || e)});
        }
        return cambios.join(', ');
    }

    function afterSubmit(ctx) {
        if (!is(ctx, 'CREATE') && !is(ctx, 'EDIT')) return;
        try {
            const id = ctx.newRecord.id;
            const rec = loadCurrent(id);
            if (Close.isClosed(rec)) return; // CIERRE se registra sólo en Suitelet.
            const cfg = C.get();
            if (!controlled(rec, cfg) && !reapproval(rec, cfg)) return;
            const create = is(ctx, 'CREATE');
            const actual = M.readHistory(rec);
            const anterior = create ? null : M.readHistory(ctx.oldRecord);
            if (!create && actual.cycle <= anterior.cycle) return;
            const tipo = create ? 'INICIO' : 'REAPROBACIÓN';
            const estadoAnterior = create ? 'SIN REGISTRO' :
                String(value(ctx.oldRecord, 'orderstatus') || '') + '/' + anterior.state;
            const camposEditados = create ? '' : resumenCamposEditados(ctx.oldRecord, rec);
            const detalle = create
                ? 'Inicio del proceso comercial. Condiciones: ' +
                    (M.checked(rec).map(r => r.name).join(', ') || 'ninguna')
                : 'Se modificaron datos comerciales y se reiniciaron las autorizaciones.' +
                    (camposEditados ? ' Cambios detectados: ' + camposEditados + '.' : '') +
                    ' Condiciones actuales: ' +
                    (M.checked(rec).map(r => r.name).join(', ') || 'ninguna');
            // La solicitud se limita a la primera matriz/etapa pendiente.
            // No se anticipan correos a condiciones posteriores.
            const next = M.nextStage(rec, cfg, actual);
            const envios = N.solicitud(next,
                create ? 'La orden requiere autorización.' :
                    'Se modificaron datos comerciales y se reiniciaron las autorizaciones.');
            const errorNotificacion = M.checked(rec).length && !envios.length
                ? (next && next.blocked ? next.reason :
                    'No se identificó una matriz pendiente para notificar.') : '';
            const salida = H.registrarSeguro({
                ordenId: id, usuarioId: runtime.getCurrentUser().id, tipo,
                ciclo: actual.cycle, detalle, estadoAnterior,
                estadoNuevo: String(value(rec, 'orderstatus') || '') + '/' + actual.state,
                origen: 'USER_EVENT', envios, errorNotificacion,
                clave: 'FUT_EVT_' + id + '_' + (create ? 'INICIO' : 'REAPROBACION') +
                    '_C' + actual.cycle
            });
            if (salida.ok && envios.length) {
                // Solicita el envío después de guardar OV + historial. La
                // respuesta al usuario NO espera a la entrega de correos.
                T.solicitar(tipo + ' OV ' + id + ' evento ' + salida.id);
            }
            if (!salida.ok) log.error({title: 'Registro de notificación pendiente',
                details: JSON.stringify({orden: id, tipo, error: salida.mensaje})});
        } catch (e) {
            log.error({title: 'FUT HISTORIAL AFTERSUBMIT', details: String(e.message || e)});
        }
    }
    return {beforeLoad, beforeSubmit, afterSubmit};
});

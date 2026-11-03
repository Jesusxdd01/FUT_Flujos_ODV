/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * FUT | Aprobar, Rechazar o Cerrar OV; motivos de catálogo e historial.
 * Script: customscript_fut_sl_ordenAprob
 * Deploy: customdeploy_fut_sl_ordenAprob
 */
define(['N/record', 'N/runtime', 'N/ui/serverWidget', 'N/log', 'N/search',
        './FUT_MD_configAprobaciones', './FUT_MD_motorAprobaciones',
        './FUT_MD_historialAprobaciones', './FUT_MD_cierreOV'],
    (record, runtime, ui, log, search, C, M, H, Close) => {

    const soId = v => {
        if (!/^\d+$/.test(String(v || '')) || Number(v) <= 0)
            C.fail('ID de orden inválido.');
        return Number(v);
    };
    const load = id => record.load({type: record.Type.SALES_ORDER,
        id, isDynamic: false});
    const val = (rec, id) => rec.getValue({fieldId: id});
    const uid = () => String(runtime.getCurrentUser().id);

    function ensureAllowed(rec, cfg) {
        if (Close.isClosed(rec)) {
            C.fail('Esta orden está cerrada definitivamente. No admite nuevas aprobaciones ni rechazos.');
        }
        if (!C.applies(rec, cfg, 'initial'))
            C.fail('Esta orden no tiene habilitado el proceso de autorizaciones de esta pantalla.');
        if (String(val(rec, 'orderstatus')) !== 'A')
            C.fail('La orden ya no está pendiente. Actualice su pantalla.');
        if (M.isOn(val(rec, 'custbody_licitacion')))
            C.fail('Las órdenes de licitación usan otro flujo.');
        if (!M.checked(rec).length)
            C.fail('Esta orden no tiene condiciones comerciales pendientes de autorización.');
    }

    // Pantalla común de RECHAZO / CIERRE, con mismo catálogo de motivos.
    // La advertencia se presenta previamente con N/ui/dialog en la OV.
    function actionForm(ctx, id, action) {
        const cfg = C.get();
        const rec = load(id);
        const closing = action === 'close';
        let next = null;
        let assessment = null;
        if (closing) {
            assessment = Close.validate(rec, cfg);
        } else {
            ensureAllowed(rec, cfg);
            next = M.nextStage(rec, cfg, M.readHistory(rec));
            if (!next || next.blocked || !next.users.includes(uid())) {
                C.fail('No está autorizado para rechazar la condición pendiente.');
            }
        }

        const form = ui.createForm({title: closing
            ? 'Motivo de cierre de orden de venta'
            : 'Rechazar aprobación comercial'});
        const detail = form.addField({id: 'custpage_detalle',
            label: closing ? 'Orden de venta' : 'Autorización',
            type: ui.FieldType.TEXT});
        detail.updateDisplayType({displayType: ui.FieldDisplayType.INLINE});
        detail.defaultValue = closing
            ? String(val(rec, 'tranid') || rec.id)
            : next.rule.name + ' - Nivel ' + next.level;

        const idField = form.addField({id: 'custpage_orden', label: 'Orden',
            type: ui.FieldType.TEXT});
        idField.updateDisplayType({displayType: ui.FieldDisplayType.HIDDEN});
        idField.defaultValue = String(id);

        const actionField = form.addField({id: 'custpage_accion', label: 'Acción',
            type: ui.FieldType.TEXT});
        actionField.updateDisplayType({displayType: ui.FieldDisplayType.HIDDEN});
        actionField.defaultValue = action;

        const reason = form.addField({id: 'custpage_motivo_id',
            label: closing ? 'Motivo de cierre' : 'Motivo de rechazo',
            type: ui.FieldType.SELECT,
            source: 'customrecord_fut_apr_motivo'});
        reason.isMandatory = true;

        if (closing) {
            // El usuario ya aceptó el diálogo nativo en la OV.
            // Se conserva el indicador como campo oculto para que el POST
            // no se procese por accidente sin recorrer el formulario.
            // Esto NO sustituye la validación de estado/cierre en servidor.
            const confirmation = form.addField({
                id: 'custpage_confirmacion',
                label: 'Confirmación previa',
                type: ui.FieldType.TEXT
            });
            confirmation.updateDisplayType({
                displayType: ui.FieldDisplayType.HIDDEN
            });
            confirmation.defaultValue = 'T';
        }
        form.addSubmitButton({label: closing
            ? 'Confirmar cierre definitivo' : 'Confirmar rechazo'});
        ctx.response.writePage(form);
    }

    // Buscar el motivo ACTIVO y conservar su nombre e ID.
    function motivoActivo(id) {
        const str = String(id === null || id === undefined ? '' : id).trim();
        if (!/^\d+$/.test(str) || Number(str) <= 0) {
            C.fail('Seleccione un motivo válido del catálogo.');
        }
        const rows = search.create({
            type: 'customrecord_fut_apr_motivo',
            filters: [['internalid', 'anyof', str], 'AND', ['isinactive', 'is', 'F']],
            columns: ['name']
        }).run().getRange({start: 0, end: 2}) || [];
        if (rows.length !== 1) {
            C.fail('El motivo seleccionado no está disponible. ' +
                'Vuelva a abrir el formulario y seleccione uno vigente.');
        }
        const nombre = String(rows[0].getValue({name: 'name'}) || '').trim();
        if (!nombre) C.fail('El motivo seleccionado no tiene nombre configurado.');
        return {id: Number(str), nombre};
    }

    function nuevasAutorizaciones(antes, despues) {
        const cambios = [];
        Object.keys(despues.done || {}).forEach(code => {
            Object.keys(despues.done[code] || {}).forEach(level => {
                const existia = antes.done[code] && antes.done[code][level];
                if (!existia) cambios.push({code, level: Number(level)});
            });
        });
        const orden = M.RULES.map(r => r.code);
        cambios.sort((a, b) => orden.indexOf(a.code) - orden.indexOf(b.code) ||
            a.level - b.level);
        return cambios;
    }

    // Las aprobaciones y rechazos mantienen exactamente el motor ya probado.
    function processApproval(id, action, reasonId) {
        const cfg = C.get();
        const rec = load(id);
        ensureAllowed(rec, cfg);
        const usuario = uid();
        const anterior = M.readHistory(rec);
        const etapaAnterior = M.nextStage(rec, cfg, anterior);
        const estadoAnterior = String(val(rec, 'orderstatus')) + '/' + anterior.state;
        const motivo = action === 'reject' ? motivoActivo(reasonId) : null;
        const result = action === 'approve'
            ? M.approve(rec, cfg, usuario)
            : M.reject(rec, cfg, usuario, motivo.nombre);
        const posterior = M.readHistory(rec);
        const estadoNuevo = String(val(rec, 'orderstatus')) + '/' + posterior.state;
        const saved = rec.save({enableSourcing: false, ignoreMandatoryFields: false});
        const alertas = [];

        if (action === 'approve') {
            nuevasAutorizaciones(anterior, posterior).forEach(item => {
                const regla = M.RULES.find(r => r.code === item.code);
                const salida = H.registrarSeguro({
                    ordenId: saved, usuarioId: usuario, tipo: 'APROBACIÓN',
                    ciclo: posterior.cycle, condicion: item.code, nivel: item.level,
                    detalle: 'Aprobó ' + (regla ? regla.name : item.code) +
                        ', nivel ' + item.level + '.', estadoAnterior, estadoNuevo,
                    origen: 'SUITELET',
                    clave: 'FUT_EVT_' + saved + '_APROBACION_C' + posterior.cycle +
                        '_COND' + item.code + '_N' + item.level
                });
                if (!salida.ok) alertas.push(item.code + '/' + item.level);
            });
        } else {
            const salida = H.registrarSeguro({
                ordenId: saved, usuarioId: usuario, tipo: 'RECHAZO',
                ciclo: posterior.cycle, motivoId: motivo.id,
                condicion: etapaAnterior.rule.code, nivel: etapaAnterior.level,
                detalle: 'Rechazo de ' + etapaAnterior.rule.name + ', nivel ' +
                    etapaAnterior.level + '. Motivo: ' + result.reason,
                estadoAnterior, estadoNuevo, origen: 'SUITELET',
                clave: 'FUT_EVT_' + saved + '_RECHAZO_C' + posterior.cycle
            });
            if (!salida.ok) alertas.push('RECHAZO');
        }
        result.historialPendiente = alertas.length > 0;
        log.audit({title: 'FUT - ' + (action === 'approve' ? 'Aprobación' : 'Rechazo'),
            details: JSON.stringify({id: saved, usuario, resultado: result,
                eventosPendientes: alertas})});
        return result;
    }

    // CIERRE: confirmar flujo previo, validar, guardar OV y registrar evento.
    function processClose(id, reasonId, confirmed) {
        if (!M.isOn(confirmed)) {
            C.fail('El cierre debe iniciarse desde el botón Cerrar. ' +
                'La orden permanece sin cambios.');
        }
        const motivo = motivoActivo(reasonId);
        const cfg = C.get();
        const rec = load(id);
        const evaluation = Close.validate(rec, cfg);
        const beforeHistory = M.readHistory(rec);
        const estadoAnterior = String(val(rec, 'orderstatus') || '') +
            '/' + beforeHistory.state;
        const usuario = uid();

        Close.apply(rec, evaluation);
        const updatedHistory = M.readHistory(rec);
        updatedHistory.state = 'closed';
        M.writeHistory(rec, updatedHistory);

        // El guardado es único: si NetSuite no admite isclosed en alguna línea,
        // rec.save falla y no se crea candado ni evento de cierre.
        const saved = rec.save({enableSourcing: false, ignoreMandatoryFields: false});

        // El estado de NetSuite puede cambiar a Closed tras cerrar las líneas.
        let nativeStatus = evaluation.status;
        try { nativeStatus = String(val(load(saved), 'orderstatus') || nativeStatus); }
        catch (e) { log.error({title: 'FUT cierre - estado final no consultable',
            details: String(e.message || e)}); }
        const nativeWarning = evaluation.nativeLineClose && nativeStatus !== 'H';
        if (nativeWarning) {
            log.error({title: 'FUT CIERRE NATIVO INCOMPLETO',
                details: 'La OV ' + saved + ' conserva estado ' + nativeStatus +
                    ' después del cierre de líneas. Revisar estado y tipos de artículo.'});
        }
        const estadoNuevo = nativeStatus + '/closed';
        const salida = H.registrarSeguro({
            ordenId: saved, usuarioId: usuario, tipo: 'CIERRE',
            ciclo: beforeHistory.cycle, motivoId: motivo.id,
            detalle: 'Cierre definitivo. Motivo: ' + motivo.nombre +
                '. Modalidad: ' + (evaluation.nativeLineClose
                    ? 'Cierre de líneas y bloqueo definitivo de edición.'
                    : 'Bloqueo definitivo. La orden permanece en estado pendiente ' +
                      'de aprobación, sin posibilidad de autorizarla.'),
            estadoAnterior, estadoNuevo, origen: 'SUITELET',
            clave: 'FUT_EVT_' + saved + '_CIERRE_C' + beforeHistory.cycle
        });
        log.audit({title: 'FUT CIERRE DEFINITIVO', details: JSON.stringify({
            id: saved, usuario, motivo: motivo.nombre,
            nativeLineClose: evaluation.nativeLineClose,
            statusAnterior: evaluation.status, statusNuevo: nativeStatus,
            historialRegistrado: salida.ok, cierreNativoPorRevisar: nativeWarning
        })});
        return {closed: true, nativeLineClose: evaluation.nativeLineClose,
            historialPendiente: !salida.ok, nativeStatus,
            cierreNativoPorRevisar: nativeWarning};
    }

    function finishPopup(ctx, pending, action, operationalWarning) {
        ctx.response.setHeader({name: 'Content-Type',
            value: 'text/html; charset=UTF-8'});
        const closing = action === 'close';
        const title = closing ? 'Cierre' : 'Rechazo';
        const msg = operationalWarning
            ? 'La orden quedó bloqueada definitivamente, pero el cierre de ' +
              'sus líneas no produjo el estado Cerrada. No intente procesarla; ' +
              'solicite a soporte que revise la operación.'
            : pending
            ? title + ' guardado correctamente, pero no se pudo registrar ' +
              'el historial. Avise a soporte y no repita la acción.'
            : closing ? 'Cierre definitivo registrado. Esta orden ya no ' +
              'puede modificarse ni aprobarse.'
            : 'Rechazo registrado correctamente. Puede cerrar esta ventana.';
        ctx.response.write('<!doctype html><html><head><meta charset="utf-8"></head>' +
            '<body style="font:14px Arial,sans-serif;padding:22px">' +
            '<p>' + msg + '</p>' +
            '<script>if(window.opener&&!window.opener.closed){' +
            'window.opener.location.reload();}' +
            ((pending || operationalWarning) ? '' : 'window.close();') +
            '</script></body></html>');
    }

    function onRequest(ctx) {
        const request = ctx.request;
        if (request.method === 'GET') {
            const action = String(request.parameters.action || 'reject').toLowerCase();
            if (!['reject', 'close'].includes(action)) C.fail('Acción no permitida.');
            if (action === 'close' && request.parameters.confirmed !== 'T') {
                C.fail('Inicie el cierre desde el botón Cerrar de la orden.');
            }
            return actionForm(ctx, soId(request.parameters.so), action);
        }
        const headers = request.headers || {};
        const contentType = String(headers['content-type'] ||
            headers['Content-Type'] || '');
        const isJson = contentType.includes('application/json');
        let data;
        if (isJson) {
            try { data = JSON.parse(request.body || '{}'); }
            catch (e) { C.fail('Solicitud JSON inválida.'); }
        } else {
            data = {
                action: request.parameters.custpage_accion || 'reject',
                so: request.parameters.custpage_orden,
                reasonId: request.parameters.custpage_motivo_id,
                confirmed: request.parameters.custpage_confirmacion
            };
        }
        const action = String(data.action || '').toLowerCase();
        if (!['approve', 'reject', 'close'].includes(action))
            C.fail('Acción no permitida.');
        // El cierre requiere el formulario de motivo de NetSuite.
        if (action === 'close' && isJson) {
            C.fail('Utilice el formulario de motivo de cierre de la orden.');
        }
        const id = soId(data.so);
        const result = action === 'close'
            ? processClose(id, data.reasonId, data.confirmed)
            : processApproval(id, action, data.reasonId);

        if (isJson) {
            ctx.response.setHeader({name: 'Content-Type',
                value: 'application/json; charset=UTF-8'});
            ctx.response.write(JSON.stringify({ok: true, result}));
        } else {
            finishPopup(ctx, result.historialPendiente, action,
                !!result.cierreNativoPorRevisar);
        }
    }
    return {onRequest};
});

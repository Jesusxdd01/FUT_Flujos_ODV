/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * FUT | Aprobar / rechazar con catálogo de motivos e historial por nivel.
 */
define(['N/record', 'N/runtime', 'N/ui/serverWidget', 'N/log', 'N/search',
        './FUT_MD_configAprobaciones', './FUT_MD_motorAprobaciones',
        './FUT_MD_historialAprobaciones'],
    (record, runtime, ui, log, search, C, M, H) => {

    const soId = v => {
        if (!/^\d+$/.test(String(v || '')) || Number(v) <= 0) C.fail('ID de orden inválido.');
        return Number(v);
    };
    const load = id => record.load({type: record.Type.SALES_ORDER, id, isDynamic: false});
    const val = (rec, id) => rec.getValue({fieldId: id});
    function ensureAllowed(rec, cfg) {
        if (!C.applies(rec, cfg, 'initial'))
            C.fail('El formulario de esta orden no pertenece al flujo FUT configurado.');
        if (String(val(rec, 'orderstatus')) !== 'A')
            C.fail('La orden ya no está pendiente. Actualice su pantalla.');
        if (M.isOn(val(rec, 'custbody_licitacion')))
            C.fail('Las órdenes de licitación usan otro flujo.');
        if (!M.checked(rec).length)
            C.fail('Esta orden no tiene condiciones comerciales pendientes del flujo FUT.');
    }

    function rejectionForm(ctx, id) {
        const cfg = C.get(), rec = load(id);
        ensureAllowed(rec, cfg);
        const next = M.nextStage(rec, cfg, M.readHistory(rec));
        const uid = String(runtime.getCurrentUser().id);
        if (!next || next.blocked || !next.users.includes(uid))
            C.fail('No está autorizado para rechazar la condición pendiente.');
        const form = ui.createForm({title: 'Rechazar aprobación comercial'});
        const detail = form.addField({id: 'custpage_detalle', label: 'Autorización',
            type: ui.FieldType.TEXT});
        detail.updateDisplayType({displayType: ui.FieldDisplayType.INLINE});
        detail.defaultValue = next.rule.name + ' - Nivel ' + next.level;
        const idField = form.addField({id: 'custpage_orden', label: 'Orden',
            type: ui.FieldType.TEXT});
        idField.updateDisplayType({displayType: ui.FieldDisplayType.HIDDEN});
        idField.defaultValue = String(id);
        // El selector se alimenta del registro personalizado FUT de motivos.
        // Al agregar/inactivar registros, NetSuite actualiza las opciones.
        const reason = form.addField({
            id: 'custpage_motivo_id',
            label: 'Motivo de rechazo',
            type: ui.FieldType.SELECT,
            source: 'customrecord_fut_apr_motivo'
        });
        reason.isMandatory = true;
        form.addSubmitButton({label: 'Confirmar rechazo'});
        ctx.response.writePage(form);
    }

    // Validar nuevamente en servidor: nunca confiar solo en el desplegable.
    function motivoActivo(id) {
        const str = String(id === null || id === undefined ? '' : id).trim();
        if (!/^\d+$/.test(str) || Number(str) <= 0) {
            C.fail('Seleccione un motivo de rechazo válido.');
        }
        const rows = search.create({
            type: 'customrecord_fut_apr_motivo',
            filters: [
                ['internalid', 'anyof', str], 'AND',
                ['isinactive', 'is', 'F']
            ],
            columns: ['name']
        }).run().getRange({start: 0, end: 2}) || [];
        if (rows.length !== 1) {
            C.fail('El motivo seleccionado ya no existe o está inactivo. ' +
                'Actualice la ventana y seleccione uno vigente.');
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

    function process(id, action, reasonId) {
        const cfg = C.get(), rec = load(id);
        ensureAllowed(rec, cfg);
        const uid = String(runtime.getCurrentUser().id);
        const anterior = M.readHistory(rec);
        const etapaAnterior = M.nextStage(rec, cfg, anterior);
        const estadoAnterior = String(val(rec, 'orderstatus')) + '/' + anterior.state;
        // Solo RECHAZAR necesita motivo. Se valida antes de modificar la OV.
        const motivo = action === 'reject' ? motivoActivo(reasonId) : null;
        const result = action === 'approve'
            ? M.approve(rec, cfg, uid)
            : M.reject(rec, cfg, uid, motivo.nombre);
        const posterior = M.readHistory(rec);
        const estadoNuevo = String(val(rec, 'orderstatus')) + '/' + posterior.state;
        const saved = rec.save({enableSourcing: false, ignoreMandatoryFields: false});
        const alertas = [];

        if (action === 'approve') {
            // Un clic puede cubrir varias matrices consecutivas.
            nuevasAutorizaciones(anterior, posterior).forEach(item => {
                const regla = M.RULES.find(r => r.code === item.code);
                const salida = H.registrarSeguro({
                    ordenId: saved,
                    usuarioId: uid,
                    tipo: 'APROBACIÓN',
                    ciclo: posterior.cycle,
                    condicion: item.code,
                    nivel: item.level,
                    detalle: 'Aprobó ' + (regla ? regla.name : item.code) +
                        ', nivel ' + item.level + '.',
                    estadoAnterior,
                    estadoNuevo,
                    origen: 'SUITELET',
                    clave: 'FUT_EVT_' + saved + '_APROBACION_C' + posterior.cycle +
                        '_COND' + item.code + '_N' + item.level
                });
                if (!salida.ok) alertas.push(item.code + '/' + item.level);
            });
        } else {
            const salida = H.registrarSeguro({
                ordenId: saved,
                usuarioId: uid,
                tipo: 'RECHAZO',
                ciclo: posterior.cycle,
                motivoId: motivo.id,
                condicion: etapaAnterior.rule.code,
                nivel: etapaAnterior.level,
                detalle: 'Rechazo de ' + etapaAnterior.rule.name +
                    ', nivel ' + etapaAnterior.level + '. Motivo: ' + result.reason,
                estadoAnterior,
                estadoNuevo,
                origen: 'SUITELET',
                clave: 'FUT_EVT_' + saved + '_RECHAZO_C' + posterior.cycle
            });
            if (!salida.ok) alertas.push('RECHAZO');
        }
        result.historialPendiente = alertas.length > 0;
        log.audit({title: 'FUT - ' + (action === 'approve' ? 'Aprobación' : 'Rechazo'),
            details: JSON.stringify({id: saved, usuario: uid, resultado: result,
                eventosPendientes: alertas})});
        return result;
    }

    function finishPopup(ctx, pendiente) {
        ctx.response.setHeader({name: 'Content-Type', value: 'text/html; charset=UTF-8'});
        const msg = pendiente
            ? 'Rechazo guardado, pero no se pudo registrar su historial. Avise a soporte.'
            : 'Rechazo registrado correctamente. Puede cerrar esta ventana.';
        ctx.response.write('<!doctype html><html><head><meta charset="utf-8"></head><body>' +
            '<p>' + msg + '</p>' +
            '<script>if(window.opener&&!window.opener.closed){window.opener.location.reload();}' +
            (pendiente ? '' : 'window.close();') + '</script></body></html>');
    }

    function onRequest(ctx) {
        const request = ctx.request;
        if (request.method === 'GET') {
            return rejectionForm(ctx, soId(request.parameters.so));
        }
        const contentType = String(request.headers['content-type'] ||
            request.headers['Content-Type'] || '');
        const isJson = contentType.includes('application/json');
        let data;
        if (isJson) {
            try { data = JSON.parse(request.body || '{}'); }
            catch (e) { C.fail('Solicitud JSON inválida.'); }
        } else {
            data = {action: 'reject', so: request.parameters.custpage_orden,
                reasonId: request.parameters.custpage_motivo_id};
        }
        const action = String(data.action || '');
        if (!['approve', 'reject'].includes(action)) C.fail('Acción no permitida.');
        const result = process(soId(data.so), action, data.reasonId);
        if (isJson) {
            ctx.response.setHeader({name: 'Content-Type',
                value: 'application/json; charset=UTF-8'});
            ctx.response.write(JSON.stringify({ok: true, result}));
        } else {
            finishPopup(ctx, result.historialPendiente);
        }
    }

    return {onRequest};
});

/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * FUT | Creación, reaprobación, bloqueo nativo, botones e historial.
 */
define(['N/record', 'N/runtime', 'N/error', 'N/log', 'N/ui/message',
        './FUT_MD_configAprobaciones', './FUT_MD_motorAprobaciones',
        './FUT_MD_historialAprobaciones'],
    (record, runtime, error, log, message, C, M, H) => {

    const F = C.F;
    const eq = (a, b) => String(a === null || a === undefined ? '' : a) ===
        String(b === null || b === undefined ? '' : b);
    const is = (ctx, which) => ctx.type === ctx.UserEventType[which];
    const nonTender = rec => !M.isOn(rec.getValue({fieldId: 'custbody_licitacion'}));
    const controlled = (rec, cfg) => nonTender(rec) && C.applies(rec, cfg, 'initial');
    const reapproval = (rec, cfg) => nonTender(rec) && C.applies(rec, cfg, 'reapprove');
    const value = (rec, id) => rec.getValue({fieldId: id});

    function nativeBlocked(rec) {
        const tranid = value(rec, 'tranid') || rec.id || '';
        throw error.create({
            name: 'APROBACION_COMERCIAL_REQUERIDA',
            notifyOff: true,
            message: 'La orden ' + tranid + ' requiere aprobación comercial. ' +
                'No es posible autorizarla desde esta lista. ' +
                'Abra la orden de venta y utilice el botón Aprobar.'
        });
    }

    function beforeLoad(ctx) {
        if (!is(ctx, 'VIEW')) return;
        const cfg = C.get();
        // En la cuenta FUT, customform llega vacío en ctx.newRecord en modo VIEW.
        const rec = record.load({type: record.Type.SALES_ORDER,
            id: ctx.newRecord.id, isDynamic: false});
        if (!controlled(rec, cfg) || String(value(rec, 'orderstatus')) !== 'A') return;
        const next = M.nextStage(rec, cfg, M.readHistory(rec));
        if (next && next.blocked) {
            ctx.form.addPageInitMessage({type: message.Type.WARNING,
                title: 'Edición pendiente', message: next.reason,
                duration: 10000});
            return;
        }
        if (!next || !next.users.includes(String(runtime.getCurrentUser().id))) return;
        ctx.form.clientScriptModulePath = './FUT_CS_accionesAprobacion.js';
        ctx.form.addButton({id: 'custpage_fut_aprobar', label: 'Aprobar',
            functionName: 'futAprobar(' + Number(rec.id) + ')'});
        ctx.form.addButton({id: 'custpage_fut_rechazar', label: 'Rechazar',
            functionName: 'futRechazar(' + Number(rec.id) + ')'});
    }

    function beforeSubmit(ctx) {
        const rec = ctx.newRecord;
        const old = ctx.oldRecord;
        const cfg = C.get();
        if (is(ctx, 'APPROVE') || is(ctx, 'REJECT')) {
            const base = old || rec;
            if (controlled(base, cfg) && M.checked(base).length) nativeBlocked(base);
            return;
        }
        if (is(ctx, 'XEDIT')) {
            // XEDIT no incluye todas las líneas: conserva el control existente.
            const stored = record.load({type: record.Type.SALES_ORDER,
                id: rec.id, isDynamic: false});
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
        const nowInit = controlled(rec, cfg);
        const nowReap = reapproval(rec, cfg);
        const previouslyControlled = old && (controlled(old, cfg) || reapproval(old, cfg));
        if (previouslyControlled && !nowInit && !nowReap) C.fail(
            'No se permite trasladar esta orden a un formulario fuera del control FUT ' +
            'mediante edición ordinaria. Consulte al administrador.');
        if (!nowInit && !nowReap) return;
        const create = is(ctx, 'CREATE');
        const changed = create || (old && nowReap && M.changed(old, rec, false));
        if (changed) {
            const previous = create ? M.blankHistory() : M.readHistory(rec);
            M.resetApprovals(rec, previous, create);
            M.refreshConditions(rec, cfg);
            M.sync(rec, cfg, M.readHistory(rec));
            log.audit({title: 'FUT Inicio/Reaprobación', details: JSON.stringify({
                id: rec.id || null,
                tranid: value(rec, 'tranid'),
                evento: ctx.type,
                ciclo: M.readHistory(rec).cycle,
                form: value(rec, 'customform'),
                condiciones: M.checked(rec).map(x => x.code)
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
            C.fail('Los campos de autorización FUT solo pueden modificarse ' +
                'mediante los botones Aprobar o Rechazar de la OV.');
        }
        const oldStatus = String(value(old, 'orderstatus') || '');
        const newStatus = String(value(rec, 'orderstatus') || '');
        if (oldStatus === 'A' && newStatus === 'B' && M.checked(rec).length &&
            !(fromApprovalService && historyChanged &&
                M.allDone(rec, cfg, M.readHistory(rec)))) {
            C.fail('No se puede liberar la orden: faltan validaciones del ' +
                'proceso comercial FUT. Apruebe desde la propia orden de venta.');
        }
    }

    function afterSubmit(ctx) {
        if (!is(ctx, 'CREATE') && !is(ctx, 'EDIT')) return;
        try {
            const id = ctx.newRecord.id;
            const rec = record.load({type: record.Type.SALES_ORDER,
                id, isDynamic: false});
            const cfg = C.get();
            if (!controlled(rec, cfg) && !reapproval(rec, cfg)) return;
            const create = is(ctx, 'CREATE');
            const actual = M.readHistory(rec);
            const anterior = create ? null : M.readHistory(ctx.oldRecord);
            // Las aprobaciones/rechazos del Suitelet no cambian el ciclo.
            if (!create && actual.cycle <= anterior.cycle) return;
            const tipo = create ? 'INICIO' : 'REAPROBACIÓN';
            const estadoAnterior = create ? 'SIN REGISTRO' :
                String(value(ctx.oldRecord, 'orderstatus') || '') + '/' + anterior.state;
            const detalle = create
                ? 'Inicio del proceso comercial. Condiciones: ' +
                    (M.checked(rec).map(r => r.name).join(', ') || 'ninguna')
                : 'Edición de datos comerciales monitoreados. Se reiniciaron todos los ' +
                    'niveles. Condiciones actuales: ' +
                    (M.checked(rec).map(r => r.name).join(', ') || 'ninguna');
            H.registrarSeguro({
                ordenId: id,
                usuarioId: runtime.getCurrentUser().id,
                tipo,
                ciclo: actual.cycle,
                detalle,
                estadoAnterior,
                estadoNuevo: String(value(rec, 'orderstatus') || '') + '/' + actual.state,
                origen: 'USER_EVENT',
                clave: 'FUT_EVT_' + id + '_' + (create ? 'INICIO' : 'REAPROBACION') +
                    '_C' + actual.cycle
            });
        } catch (e) {
            // La OV ya fue guardada: no presentar su guardado como fallido.
            log.error({title: 'FUT HISTORIAL AFTERSUBMIT', details: String(e.message || e)});
        }
    }

    return {beforeLoad, beforeSubmit, afterSubmit};
});

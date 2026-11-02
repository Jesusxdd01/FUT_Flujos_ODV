/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * FUT - Aprobar / rechazar desde OV. Validación de usuario y matriz en servidor.
 * ID sugerido: customscript_fut_sl_ordenAprob
 * Deploy:      customdeploy_fut_sl_ordenAprob
 */
define(['N/record','N/runtime','N/ui/serverWidget','N/log','N/error',
        './FUT_MD_configAprobaciones','./FUT_MD_motorAprobaciones'],
    (record,runtime,ui,log,error,C,M) => {
    const F=C.F;
    const soId = v => {
        if (!/^\d+$/.test(String(v||'')) || Number(v)<=0) C.fail('ID de orden inválido.');
        return Number(v);
    };
    function load(id) {return record.load({type:record.Type.SALES_ORDER,id,isDynamic:false});}
    function ensureAllowed(rec,cfg) {
        if (!C.applies(rec,cfg,'initial')) C.fail('El formulario de esta orden no pertenece al flujo FUT configurado.');
        if (String(rec.getValue({fieldId:'orderstatus'}))!=='A') C.fail('La orden ya no está pendiente. Actualice su pantalla.');
        if (String(rec.getValue({fieldId:'custbody_licitacion'}))==='T') C.fail('Las órdenes de licitación usan otro flujo.');
        if (!M.checked(rec).length) C.fail('Esta orden no tiene condiciones comerciales pendientes del flujo FUT.');
    }
    function rejectionForm(ctx,id) {
        const cfg=C.get(),rec=load(id); ensureAllowed(rec,cfg);
        const h=M.readHistory(rec), next=M.nextStage(rec,cfg,h);
        const uid=String(runtime.getCurrentUser().id);
        if (!next || next.blocked || !next.users.includes(uid)) C.fail('No está autorizado para rechazar la condición pendiente.');
        const form=ui.createForm({title:'Rechazar aprobación comercial'});
        const detail=form.addField({id:'custpage_detalle',label:'Autorización',type:ui.FieldType.TEXT});
        detail.updateDisplayType({displayType:ui.FieldDisplayType.INLINE});
        detail.defaultValue=next.rule.name+' - Nivel '+next.level;
        const idField=form.addField({id:'custpage_orden',label:'Orden',type:ui.FieldType.TEXT});
        idField.updateDisplayType({displayType:ui.FieldDisplayType.HIDDEN}); idField.defaultValue=String(id);
        const reason=form.addField({id:'custpage_motivo',label:'Motivo de rechazo',type:ui.FieldType.TEXTAREA});
        reason.isMandatory=true;
        form.addSubmitButton({label:'Confirmar rechazo'});
        ctx.response.writePage(form);
    }
    function process(id,action,reason) {
        const cfg=C.get(), rec=load(id);
        ensureAllowed(rec,cfg);
        const uid=String(runtime.getCurrentUser().id);
        const result=action==='approve' ? M.approve(rec,cfg,uid) : M.reject(rec,cfg,uid,reason);
        const saved=rec.save({enableSourcing:false,ignoreMandatoryFields:false});
        log.audit({title:'FUT - '+(action==='approve'?'Aprobación':'Rechazo'),
            details:JSON.stringify({id:saved,usuario:uid,resultado:result})});
        return result;
    }
    function finishPopup(ctx) {
        ctx.response.setHeader({name:'Content-Type',value:'text/html; charset=UTF-8'});
        ctx.response.write('<!doctype html><html><head><meta charset="utf-8"></head><body>'+
            '<p>Rechazo registrado correctamente. Puede cerrar esta ventana.</p>'+
            '<script>if(window.opener&&!window.opener.closed){window.opener.location.reload();}window.close();</script>'+
            '</body></html>');
    }
    function onRequest(ctx) {
        const request=ctx.request;
        if (request.method==='GET') {
            const id=soId(request.parameters.so);
            return rejectionForm(ctx,id);
        }
        let data;
        if (String(request.headers['content-type']||request.headers['Content-Type']||'').includes('application/json')) {
            try {data=JSON.parse(request.body||'{}');} catch(e){C.fail('Solicitud JSON inválida.');}
        } else {
            data={action:'reject',so:request.parameters.custpage_orden,
                reason:request.parameters.custpage_motivo};
        }
        const action=String(data.action||'');
        if (!['approve','reject'].includes(action)) C.fail('Acción no permitida.');
        const id=soId(data.so);
        const result=process(id,action,data.reason);
        if (String(request.headers['content-type']||request.headers['Content-Type']||'').includes('application/json')) {
            ctx.response.setHeader({name:'Content-Type',value:'application/json; charset=UTF-8'});
            ctx.response.write(JSON.stringify({ok:true,result}));
        } else finishPopup(ctx);
    }
    return {onRequest};
});

/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * Configuración del flujo de aprobaciones ODV, formularios por lista.
 * Script ID: customscript_fut_sl_cfg_flujo
 * Deployment ID: customdeploy_fut_sl_cfg_flujo
 * Administra EXCLUSIVAMENTE el registro CONFIG_UNICA.
 * Nunca muestra ni modifica términos de pago ni nivel de precio base.
 * Restringir el despliegue al rol administrador desde Audience.
 */
define([
    'N/ui/serverWidget','N/ui/message','N/redirect','N/url','N/log',
    './FUT_MD_adminAprobaciones'
], (ui,message,redirect,url,log,A) => {
    const SCRIPT='customscript_fut_sl_cfg_flujo';
    const DEPLOY='customdeploy_fut_sl_cfg_flujo';
    const p=(req,name)=>String(req.parameters[name] || '');

    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/\"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function removeAnchor(group,id) {
        return '<a href="#" data-fut-action="removeForm" data-fut-group="'+
            esc(group)+'" data-fut-form="'+esc(id)+'">Quitar</a>';
    }
    function path(params) {
        return url.resolveScript({scriptId:SCRIPT,deploymentId:DEPLOY,
            params:params || {},returnExternalUrl:false});
    }
    function go(params) {
        redirect.toSuitelet({scriptId:SCRIPT,deploymentId:DEPLOY,
            parameters:params || {}});
    }
    function back(form,label,params) {
        form.addPageLink({type:ui.FormPageLinkType.CROSSLINK,
            title:label,url:path(params)});
    }
    function hidden(form,id,value) {
        const f=form.addField({id,type:ui.FieldType.TEXT,label:'Control'});
        f.defaultValue=String(value || '');
        f.updateDisplayType({displayType:ui.FieldDisplayType.HIDDEN});
    }
    function inline(form,id,label,value) {
        const f=form.addField({id,type:ui.FieldType.TEXT,label});
        f.defaultValue=String(value || '');
        f.updateDisplayType({displayType:ui.FieldDisplayType.INLINE});
    }
    function errorBanner(form,err) {
        if (err) form.addPageInitMessage({type:message.Type.ERROR,
            title:'No se pudo completar la operación',message:String(err),duration:0});
    }
    function cell(list,id,row,value) {
        const v=String(value === undefined || value === null ? '' : value);
        if (v) list.setSublistValue({id,line:row,value:v});
    }
    function formName(formId,byId) {
        return (byId[formId] || ('Formulario '+formId+' (no disponible)'));
    }

    // ==========================================================
    // PANTALLA PRINCIPAL: UN SELECTOR + TRES LISTAS
    // ==========================================================
    function show(ctx,errorText,submitted) {
        const current=A.getFlow();   // Solo CONFIG_UNICA.
        const available=A.formsAvailable(); // Solo formularios de orden de venta.
        const byId={};
        available.forEach(f=>{byId[String(f.value)]=String(f.text);});
        const form=ui.createForm({title:'Configuración del flujo de aprobaciones ODV'});
        form.clientScriptModulePath='./FUT_CS_adminAprobaciones.js';
        errorBanner(form,errorText);
        hidden(form,'custpage_action','addForm');

        const group=form.addFieldGroup({id:'custpage_addgroup',
            label:'Agregar formulario'});
        const select=form.addField({id:'custpage_form',type:ui.FieldType.SELECT,
            label:'Formulario de orden de venta',container:'custpage_addgroup'});
        select.addSelectOption({value:'',text:'Seleccione un formulario'});
        available.forEach(f=>select.addSelectOption({
            value:String(f.value),text:String(f.text)}));
        select.isMandatory=true;
        const dest=form.addField({id:'custpage_group',type:ui.FieldType.SELECT,
            label:'Agregar a',container:'custpage_addgroup'});
        dest.addSelectOption({value:'initial',text:'Aprobación inicial'});
        dest.addSelectOption({value:'reapprove',text:'Reaprobación'});
        dest.addSelectOption({value:'excluded',text:'Formularios excluidos'});
        dest.isMandatory=true;
        if (submitted && submitted.group) dest.defaultValue=submitted.group;
        if (submitted && submitted.form) select.defaultValue=submitted.form;
        form.addSubmitButton({label:'Agregar formulario'});

        [
            {key:'initial',title:'Formularios con aprobación inicial'},
            {key:'reapprove',title:'Formularios con reaprobación'},
            {key:'excluded',title:'Formularios excluidos'}
        ].forEach((block,index)=>{
            const ids=A.ids(current[block.key]);
            const list=form.addSublist({id:'custpage_list'+(index+1),
                type:ui.SublistType.LIST,
                label:block.title+' ('+ids.length+')'});
            list.addField({id:'custpage_name',
                type:ui.FieldType.TEXT,label:'Formulario'});
            list.addField({id:'custpage_remove',
                type:ui.FieldType.TEXT,label:'Acción'});
            ids.sort((a,b)=>formName(a,byId).localeCompare(formName(b,byId),'es'));
            ids.forEach((id,line)=>{
                cell(list,'custpage_name',line,formName(id,byId));
                cell(list,'custpage_remove',line,removeAnchor(block.key,id));
            });
        });
        ctx.response.writePage(form);
    }

    function onRequest(ctx) {
        const req=ctx.request;
        try {
            if (req.method==='POST' && /^application\/json/i.test(String(
                    (req.headers && (req.headers['content-type'] || req.headers['Content-Type'])) || ''))) {
                let body={};
                try {body=JSON.parse(req.body||'{}');}
                catch(e) {body={};}
                let reply;
                try {
                    if (body.fut_ajax !== true || body.action!=='removeForm') {
                        A.fail('Solicitud inválida.');
                    }
                    A.removeFlowForm(body.formId,body.group);
                    reply={ok:true};
                } catch(e) {
                    log.error({title:'No se pudo quitar formulario',details:String(e.stack||e)});
                    reply={ok:false,message:String(e.message||e)};
                }
                ctx.response.setHeader({name:'Content-Type',value:'application/json; charset=UTF-8'});
                ctx.response.write(JSON.stringify(reply));
                return;
            }
            if (req.method==='POST') {
                const action=p(req,'custpage_action');
                if (action==='addForm') {
                    const input={form:p(req,'custpage_form'),group:p(req,'custpage_group')};
                    try {
                        A.addFlowForm(input.form,input.group);
                        go({});
                    } catch(e) {
                        log.error({title:'Error al agregar formulario',details:String(e.stack||e)});
                        show(ctx,String(e.message||e),input);
                    }
                    return;
                }
                if (action==='removeForm') {
                    try {
                        A.removeFlowForm(p(req,'custpage_form'),p(req,'custpage_group'));
                        go({});
                    } catch(e) {
                        log.error({title:'No se pudo quitar formulario',details:String(e.stack||e)});
                        show(ctx,String(e.message||e));
                    }
                    return;
                }
                A.fail('Acción desconocida.');
            }
            const mode=p(req,'mode');
            if (!mode) show(ctx);
            else A.fail('Pantalla desconocida.');
        } catch(e) {
            log.error({title:'Error en configurar flujo',details:String(e.stack||e)});
            const form=ui.createForm({title:'Configuración del flujo de aprobaciones ODV'});
            back(form,'Volver a formularios',{});
            errorBanner(form,String(e.message||e));
            ctx.response.writePage(form);
        }
    }
    return {onRequest};
});

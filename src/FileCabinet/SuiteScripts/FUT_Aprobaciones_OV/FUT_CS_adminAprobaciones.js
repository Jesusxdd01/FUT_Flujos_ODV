/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 * Confirmación nativa para acciones de administración de matrices y flujo.
 * Se asocia con form.clientScriptModulePath; sin despliegue independiente.
 */
define(['N/ui/dialog','N/https','N/url','N/currentRecord'],(dialog,https,url,currentRecord)=>{
    const MATRIX_SCRIPT='customscript_fut_sl_cfg_matrices';
    const MATRIX_DEPLOY='customdeploy_fut_sl_cfg_matrices';
    const FLOW_SCRIPT='customscript_fut_sl_cfg_flujo';
    const FLOW_DEPLOY='customdeploy_fut_sl_cfg_flujo';
    let working=false;

    function navigation(scriptId,deploymentId,params) {
        const path=url.resolveScript({scriptId,deploymentId,params:params||{},returnExternalUrl:false});
        window.location.assign(path);
    }
    function futVolverMatrices() { navigation(MATRIX_SCRIPT,MATRIX_DEPLOY,{mode:'list'}); }
    function futNuevaMatriz() { navigation(MATRIX_SCRIPT,MATRIX_DEPLOY,{mode:'new'}); }

    function actionInfo(link) {
        const action=link.getAttribute('data-fut-action');
        if (action==='removeEmployee') {
            return {
                scriptId:MATRIX_SCRIPT,deploymentId:MATRIX_DEPLOY,
                title:'Quitar aprobador',
                message:'¿Desea quitar a este empleado del nivel de aprobación? El cambio se aplicará a la matriz.',
                body:{fut_ajax:true,action,mid:link.getAttribute('data-fut-mid'),
                    level:link.getAttribute('data-fut-level'),
                    employee:link.getAttribute('data-fut-employee')},
                returnParams:{mode:'edit',custom_matrix_id:link.getAttribute('data-fut-mid')}
            };
        }
        if (action==='disableMatrix') {
            return {
                scriptId:MATRIX_SCRIPT,deploymentId:MATRIX_DEPLOY,
                title:'Desactivar matriz',
                message:'¿Desea desactivar esta matriz? Sus aprobadores dejarán de estar disponibles para nuevas autorizaciones.',
                body:{fut_ajax:true,action,mid:link.getAttribute('data-fut-mid')},
                returnParams:{mode:'list'}
            };
        }
        if (action==='removeForm') {
            return {
                scriptId:FLOW_SCRIPT,deploymentId:FLOW_DEPLOY,
                title:'Quitar formulario',
                message:'¿Desea quitar este formulario de la lista seleccionada?',
                body:{fut_ajax:true,action,group:link.getAttribute('data-fut-group'),
                    formId:link.getAttribute('data-fut-form')},
                returnParams:{}
            };
        }
        return null;
    }
    function notifyError(e) {
        const msg=String(e && e.message || e || 'No fue posible completar la operación.');
        dialog.alert({title:'No se pudo completar la operación',message:msg});
    }
    function confirmAndSend(info) {
        if (!info || working) return;
        dialog.confirm({title:info.title,message:info.message}).then(answer=>{
            if (!answer || working) return;
            working=true;
            return https.requestSuitelet.promise({
                scriptId:info.scriptId,deploymentId:info.deploymentId,
                method:https.Method.POST,
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify(info.body)
            }).then(response=>{
                let data;
                try {data=JSON.parse(response.body||'{}');}
                catch (parseError) {throw Error('NetSuite devolvió una respuesta inesperada. Revise el registro de ejecución del Suitelet.');}
                if (!data.ok) throw Error(data.message||'No fue posible guardar el cambio.');
                navigation(info.scriptId,info.deploymentId,info.returnParams);
            });
        }).catch(notifyError).finally(()=>{working=false;});
    }
    function pageInit(){
        // Los enlaces en sublistas LIST no admiten functionName.
        // Se escucha solamente en los enlaces del administrador.
        document.addEventListener('click',event=>{
            const target=event.target;
            const link=target && typeof target.closest==='function' ?
                target.closest('a[data-fut-action]') : null;
            if (!link) return;
            event.preventDefault();
            confirmAndSend(actionInfo(link));
        });
    }
    function futDesactivarMatriz(){
        const id=String(currentRecord.get().getValue({fieldId:'custpage_mid'})||'');
        if (!/^\d+$/.test(id)) {notifyError('No se identificó la matriz. Actualice la página.');return;}
        // La misma ruta confirmada que utilizan los enlaces de las tablas.
        confirmAndSend(actionInfo({getAttribute:k=>k==='data-fut-action'?'disableMatrix':id}));
    }
    return {pageInit,futVolverMatrices,futNuevaMatriz,futDesactivarMatriz};
});

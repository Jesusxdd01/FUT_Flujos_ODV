/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * FUT - Botones Aprobar/Rechazar añadidos por el User Event en modo VIEW.
 * Se adjunta vía form.clientScriptModulePath; NO desplegar globalmente.
 * ID opcional de registro: customscript_fut_cs_accionAprob
 */
define(['N/url','N/https','N/ui/dialog'], (url,https,dialog) => {
    const scriptId='customscript_fut_sl_ordenAprob';
    const deploymentId='customdeploy_fut_sl_ordenAprob';
    let busy=false;
    function endpoint(params) {
        return url.resolveScript({scriptId,deploymentId,returnExternalUrl:false,params:params||{}});
    }
    function errorText(resp) {
        const raw=String(resp.body||'');
        try {const obj=JSON.parse(raw);return obj.message||obj.error?.message||raw.slice(0,800);}
        catch(e) {return raw.replace(/<[^>]*>/g,' ').slice(0,800) || 'Error HTTP '+resp.code;}
    }
    function futAprobar(id) {
        if (busy) return;
        dialog.confirm({title:'Autorizar orden de venta',
            message:'Se registrarán las autorizaciones comerciales para las que usted esté habilitado en la matriz vigente. ¿Continuar?'
        }).then(yes=>{
            if (!yes || busy) return;
            busy=true;
            https.post.promise({url:endpoint(),
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({action:'approve',so:String(id)})
            }).then(resp=>{
                if (resp.code<200 || resp.code>=300) throw Error(errorText(resp));
                const data=JSON.parse(resp.body);
                if (!data.ok) throw Error(data.message||'La aprobación no se completó.');
                if (data.result && data.result.historialPendiente) {
                    dialog.alert({
                        title: 'Aprobación guardada con advertencia',
                        message: 'La aprobación se guardó, pero no fue posible registrar ' +
                            'su historial. Avise a soporte para revisar el registro de ejecución.'
                    }).then(() => window.location.reload());
                } else {
                    window.location.reload();
                }
            }).catch(e=>dialog.alert({title:'No se pudo aprobar',message:String(e.message||e)}))
            .finally(()=>{busy=false;});
        });
    }
    function futRechazar(id) {
        if (busy) return;
        const popup=window.open(endpoint({so:String(id)}),'futRechazo','width=700,height=600,resizable=yes,scrollbars=yes');
        if (!popup) dialog.alert({title:'Ventana bloqueada',message:'Permita las ventanas emergentes de NetSuite para registrar el motivo de rechazo.'});
    }
    // Punto de entrada obligatorio al registrar el archivo como Client Script 2.1.
    // No necesita acciones: las funciones se invocan con botones del User Event.
    function pageInit(context) {
        // Sin operación: mantener las aprobaciones solo mediante los botones.
    }
    return {pageInit,futAprobar,futRechazar};
});

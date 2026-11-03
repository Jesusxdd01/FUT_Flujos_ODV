/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * FUT | Botones de aprobación, rechazo y cierre definitivo en modo VIEW.
 * Se adjunta mediante form.clientScriptModulePath (no despliegue global).
 */
define(['N/url', 'N/https', 'N/ui/dialog'], (url, https, dialog) => {
    const scriptId = 'customscript_fut_sl_ordenAprob';
    const deploymentId = 'customdeploy_fut_sl_ordenAprob';
    let busy = false;

    function endpoint(params) {
        return url.resolveScript({scriptId, deploymentId,
            returnExternalUrl: false, params: params || {}});
    }
    function errorText(resp) {
        const raw = String(resp.body || '');
        try {
            const obj = JSON.parse(raw);
            return obj.message || (obj.error && obj.error.message) || raw.slice(0, 800);
        } catch (e) {
            return raw.replace(/<[^>]*>/g, ' ').slice(0, 800) ||
                'Error HTTP ' + resp.code;
        }
    }
    function openPopup(id, action, name, title, extraParams) {
        if (busy) return;
        const popup = window.open(endpoint(Object.assign(
            {so: String(id), action}, extraParams || {})), name,
            'width=740,height=650,resizable=yes,scrollbars=yes');
        if (!popup) {
            dialog.alert({title: 'Ventana bloqueada',
                message: 'Permita las ventanas emergentes de NetSuite para ' + title + '.'});
        }
    }
    function futAprobar(id) {
        if (busy) return;
        dialog.confirm({title: 'Autorizar orden de venta',
            message: 'Se registrarán las autorizaciones comerciales para las que ' +
                'usted esté habilitado en la matriz vigente. ¿Continuar?'
        }).then(yes => {
            if (!yes || busy) return;
            busy = true;
            https.post.promise({url: endpoint(),
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({action: 'approve', so: String(id)})
            }).then(resp => {
                if (resp.code < 200 || resp.code >= 300) throw Error(errorText(resp));
                const data = JSON.parse(resp.body);
                if (!data.ok) throw Error(data.message || 'La aprobación no se completó.');
                if (data.result && data.result.historialPendiente) {
                    dialog.alert({title: 'Aprobación guardada con advertencia',
                        message: 'La aprobación se guardó, pero no fue posible ' +
                            'registrar su historial. Avise a soporte.'
                    }).then(() => window.location.reload());
                } else {
                    window.location.reload();
                }
            }).catch(e => dialog.alert({title: 'No se pudo aprobar',
                message: String(e.message || e)}))
                .finally(() => { busy = false; });
        });
    }
    function futRechazar(id) {
        openPopup(id, 'reject', 'futRechazo', 'registrar el rechazo');
    }
    function futCerrar(id) {
        if (busy) return;
        // La advertencia y confirmación se muestran desde la propia OV.
        // Aceptar abre el formulario de motivo; todavía NO cierra la orden.
        dialog.confirm({
            title: 'Atención: cierre definitivo',
            message: 'Esta orden de venta se cerrará definitivamente una vez que ' +
                'selecciones el motivo y confirmes la operación. ' +
                'Después del cierre no será posible editarla ni aprobarla nuevamente. ' +
                '¿Deseas continuar?'
        }).then(yes => {
            if (!yes || busy) return;
            openPopup(id, 'close', 'futCierre', 'seleccionar el motivo de cierre',
                {confirmed: 'T'});
        }).catch(e => dialog.alert({
            title: 'No se pudo mostrar la confirmación de cierre',
            message: String(e.message || e)
        }));
    }
    function pageInit(context) {
        // Entrada necesaria de SuiteScript 2.1. Los botones invocan las funciones.
    }
    return {pageInit, futAprobar, futRechazar, futCerrar};
});

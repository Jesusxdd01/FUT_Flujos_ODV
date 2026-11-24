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
    const MSG_MOSTRADOR =
        'Para evitar inconsistencias con las transacciones relacionadas, ' +
        'deberá realizar el proceso de devolución, cierre y creación ' +
        'de una nueva orden de venta.';

    const str = v => String(v === null || v === undefined ? '' : v).trim();

    function valorSeguro(rec, fieldId) {
        try { return rec.getValue({fieldId}); }
        catch (e) { return ''; }
    }

    function clienteProtegidoModificado(rec) {
        // Los campos custpage se precargan desde beforeLoad cuando el
        // cliente guardado cumple los términos y nivel protegidos en CONFIG_UNICA.
        const original = str(valorSeguro(rec, 'custpage_fut_cliente_original'));
        const actual = str(valorSeguro(rec, 'entity'));
        if (!original || original === actual) return false;

        // La lista de formularios excluidos también proviene de CONFIG_UNICA.
        const formularios = str(valorSeguro(rec, 'custpage_fut_forms_excluidos'))
            .split(/[\s,;]+/).filter(Boolean);
        const formOriginal = str(valorSeguro(rec, 'custpage_fut_form_original'));
        const formActual = str(valorSeguro(rec, 'customform'));
        return formularios.includes(formOriginal) || formularios.includes(formActual);
    }

    function fieldChanged(context) {
        // Aviso anticipado: el servidor volverá a verificar antes de guardar.
        if (context.fieldId !== 'entity' && context.fieldId !== 'customform') return;
        if (!clienteProtegidoModificado(context.currentRecord)) return;
        dialog.alert({title: 'Cambio de cliente no permitido', message: MSG_MOSTRADOR});
    }

    function saveRecord(context) {
        // Impide el guardado desde la interfaz, sin consultar nuevamente NetSuite.
        // El User Event es la autoridad para cambios por otras vías.
        if (!clienteProtegidoModificado(context.currentRecord)) return true;
        dialog.alert({title: 'Cambio de cliente no permitido', message: MSG_MOSTRADOR});
        return false;
    }

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
            message: 'Se aprobará la orden según el flujo que corresponda: ' +
                'general o comercial por matrices. ¿Continuar?'
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
    return {pageInit, fieldChanged, saveRecord, futAprobar, futRechazar, futCerrar};
});

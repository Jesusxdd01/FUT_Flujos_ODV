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
    // Esta protección se inicia para clientes MOSTRADOR en cualquier formulario.
    // La restricción solo se activa si el formulario original o actual está EXCLUIDO.
    let clienteOriginal = '';
    let formularioOriginal = '';
    let formulariosExcluidos = new Set();
    let validarMostrador = false;
    let restaurandoCliente = false;
    let avisoAbierto = false;
    const MSG_MOSTRADOR =
        'Para evitar inconsistencias con las transacciones relacionadas, ' +
        'deberá realizar el proceso de devolución, cierre y creación ' +
        'de una nueva orden de venta.';
    const igualId = (a, b) => String(a === null || a === undefined ? '' : a) ===
        String(b === null || b === undefined ? '' : b);
    function informarCambioNoPermitido() {
        // Evita ventanas duplicadas durante el sourcing de NetSuite.
        if (avisoAbierto) return;
        avisoAbierto = true;
        dialog.alert({
            title: 'No es posible modificar el cliente',
            message: MSG_MOSTRADOR
        }).catch(() => {}).finally(() => { avisoAbierto = false; });
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
    function campoValor(rec, fieldId) {
        try { return String(rec.getValue({fieldId}) || ''); }
        catch (e) { return ''; }
    }
    function estaExcluido(formId) {
        return formulariosExcluidos.has(String(formId || ''));
    }
    function restriccionAplica(rec) {
        return validarMostrador &&
            (estaExcluido(formularioOriginal) ||
                estaExcluido(campoValor(rec, 'customform')));
    }
    function pageInit(context) {
        // El User Event proporciona el cliente y formulario PERSISTIDOS,
        // además de la lista de formularios excluidos de CONFIG_UNICA.
        // Nunca usar el cliente visible como clienteOriginal.
        clienteOriginal = '';
        formularioOriginal = '';
        formulariosExcluidos = new Set();
        validarMostrador = false;
        restaurandoCliente = false;
        if (context.mode !== 'edit') return;
        const rec = context.currentRecord;
        clienteOriginal = campoValor(rec, 'custpage_fut_cliente_original');
        formularioOriginal = campoValor(rec, 'custpage_fut_form_original');
        const ids = campoValor(rec, 'custpage_fut_forms_excluidos');
        formulariosExcluidos = new Set(ids.split(',').map(x => x.trim()).filter(Boolean));
        validarMostrador = !!clienteOriginal && formulariosExcluidos.size > 0;
    }
    function restaurarCliente(rec) {
        if (restaurandoCliente) return;
        restaurandoCliente = true;
        try {
            rec.setValue({
                fieldId: 'entity', value: clienteOriginal,
                ignoreFieldChange: true, forceSyncSourcing: true
            });
        } catch (e) {
            // Si el formulario bloquea la restauración, saveRecord evita
            // guardar el cambio y beforeSubmit conserva el candado final.
        } finally {
            restaurandoCliente = false;
        }
    }
    function validateField(context) {
        if (context.sublistId || context.fieldId !== 'entity' ||
            !restriccionAplica(context.currentRecord)) return true;
        // Impide confirmar un cliente diferente ANTES del sourcing nativo.
        // No depende de pulsar Guardar y no envía la orden al servidor.
        informarCambioNoPermitido();
        return false;
    }
    function fieldChanged(context) {
        if (!validarMostrador || restaurandoCliente || context.sublistId) return;
        const rec = context.currentRecord;
        if (context.fieldId !== 'entity' && context.fieldId !== 'customform') return;
        if (!restriccionAplica(rec)) return;
        if (igualId(campoValor(rec, 'entity'), clienteOriginal)) return;
        // Respaldo si NetSuite omite validateField por sourcing o por el
        // selector de formulario. Si se vuelve excluido durante la edición,
        // también restaura el cliente si este había cambiado previamente.
        restaurarCliente(rec);
        informarCambioNoPermitido();
    }
    function saveRecord(context) {
        if (!restriccionAplica(context.currentRecord)) return true;
        if (igualId(campoValor(context.currentRecord, 'entity'), clienteOriginal)) {
            return true;
        }
        // Última oportunidad de detener el envío desde la UI.
        informarCambioNoPermitido();
        return false;
    }
    return {pageInit, validateField, fieldChanged, saveRecord,
        futAprobar, futRechazar, futCerrar};
});

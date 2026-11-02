/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * FUT | Limpia campos heredados al copiar OV (el UE lo refuerza en CREATE).
 * Script: customscript_fut_cs_limpiarCopia
 * Deploy: customdeploy_fut_cs_limpiarCopia (Sales Order)
 */
define([], () => {
    const conditions = [
        'custbody_nso_fut_discount_rate','custbody_nso_fut_price_specific',
        'custbody_nso_fut_days_credit','custbody_nso_fut_credit_add',
        'custbody_nso_fut_expiration_days','custbody_nos_fut_credit_exceeded',
        'custbody_nso_fut_workshop_sales','custbody_nos_fut_level_price'
    ];
    const approvals = [
        'custbody_nso_fut_app_percent_discount','custbody_nso_fut_app_specific_price',
        'custbody_nso_fut_app_credit_days','custbody_nso_fut_app_additional_credit',
        'custbody_nso_app_expiration_days','custbody_nso_fut_app_price_level',
        'custbody_nso_app_credit_exceeded','custbody_nso_fut_app_workshop_sales',
        'custbody_nso_aprobacion_dias_credito_2','custbody_nso_aprob_monto_cred_ad_2'
    ];
    function trySet(rec, fieldId, value) {
        try { rec.setValue({fieldId, value, ignoreFieldChange:true}); }
        catch(e) { console.log('FUT: campo de copia no editable ' + fieldId + ': ' + e.message); }
    }
    function pageInit(ctx) {
        if (ctx.mode !== 'copy') return;
        const rec = ctx.currentRecord;
        conditions.concat(approvals).forEach(id => trySet(rec,id,false));
        trySet(rec,'custbody_nso_next_approver',[]);
        trySet(rec,'custbody_nso_level_approval','');
        trySet(rec,'custbody_nso_motivo_aprobacion_rechazo','');
        trySet(rec,'custbody_nso_limite_credito',0);
        trySet(rec,'custbody_nso_limite_credito_actual',0);
        trySet(rec,'custbody_fut_apr_hist','');
        // Intencionalmente NO modifica custbody_nso_descuento_especial.
    }
    return {pageInit};
});

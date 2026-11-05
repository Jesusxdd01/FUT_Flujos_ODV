/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * FUT | Configuración ÚNICA en registro personalizado; sin parámetros de script.
 * Crear customrecord_fut_apr_cfg y sus campos antes del despliegue.
 */
define(['N/search', 'N/error'], (search, error) => {
    const CFG = 'customrecord_fut_apr_cfg';
    const F = Object.freeze({
        history: 'custbody_fut_apr_hist',
        next: 'custbody_nso_next_approver',
        level: 'custbody_nso_level_approval',
        reason: 'custbody_nso_motivo_aprobacion_rechazo'
    });
    const SCRIPT = Object.freeze({
        suitelet: 'customscript_fut_sl_ordenAprob',
        suiteletDeploy: 'customdeploy_fut_sl_ordenAprob'
    });
    const FIELD = Object.freeze({
        enabled: 'custrecord_fut_cfg_enabled',
        initial: 'custrecord_fut_cfg_forms_init',
        reapprove: 'custrecord_fut_cfg_forms_reap',
        excluded: 'custrecord_fut_cfg_forms_excl',
        terms: 'custrecord_fut_cfg_base_terms',
        price: 'custrecord_fut_cfg_base_price',
        closeOnReject: 'custrecord_fut_cfg_close_rej'
    });
    const isOn = value => value === true || value === 'T';
    function fail(message) {
        throw error.create({ name: 'FUT_CONFIG_APROB', message, notifyOff: false });
    }
    function idList(value) {
        return [...new Set(String(value || '').split(/[\s,;]+/)
            .map(x => x.trim()).filter(x => /^\d+$/.test(x) && Number(x) > 0))];
    }
    // Únicamente la configuración oficial participa en el flujo.
    function uniqueRow(columns) {
        const results = search.create({
            type: CFG,
            filters: [['name','is','CONFIG_UNICA'],'AND',['isinactive','is','F']],
            columns: columns
        }).run().getRange({start:0, end:2}) || [];
        if (results.length !== 1) {
            fail('Debe existir exactamente un registro activo con nombre CONFIG_UNICA. Encontrados: ' + results.length);
        }
        return results[0];
    }
    function getUniqueId() {
        return Number(uniqueRow(['internalid']).id);
    }
    function get() {
        const row = uniqueRow([
            'internalid', FIELD.enabled, FIELD.initial, FIELD.reapprove,
            FIELD.excluded, FIELD.terms, FIELD.price, FIELD.closeOnReject
        ]);
        const g = name => row.getValue({ name: FIELD[name] });
        if (!isOn(g('enabled'))) fail('La configuración FUT está deshabilitada. No es seguro procesar aprobaciones.');
        const cfg = {
            initial: idList(g('initial')),
            reapprove: idList(g('reapprove')),
            excluded: idList(g('excluded')),
            baseTerms: String(g('terms') || '').trim(),
            basePrice: String(g('price') || '').trim(),
            closeOnReject: isOn(g('closeOnReject'))
        };
        if (!cfg.initial.length || !cfg.reapprove.length || !cfg.baseTerms || !cfg.basePrice) {
            fail('La configuración FUT requiere formularios iniciales, de reaprobación, término base y precio base.');
        }
        if (cfg.initial.some(x => cfg.excluded.includes(x)) ||
            cfg.reapprove.some(x => cfg.excluded.includes(x))) {
            fail('Un formulario FUT aparece simultáneamente como controlado y excluido. Corrija la configuración.');
        }
        return cfg;
    }
    function applies(rec, cfg, purpose) {
        const id = String(rec.getValue({fieldId:'customform'}) || '');
        return !!id && !cfg.excluded.includes(id) &&
            (purpose === 'reapprove' ? cfg.reapprove : cfg.initial).includes(id);
    }
    return { CFG, F, SCRIPT, FIELD, get, getUniqueId, idList, isOn, applies, fail };
});

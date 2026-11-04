/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * FUT - Motor de aprobaciones y matrices existentes de Netsoft.
 * Biblioteca: no requiere registro ni despliegue de script.
 */
define(['N/search', 'N/error', './FUT_MD_configAprobaciones'],
    (search, error, C) => {
    const F = C.F;
    // Orden Netsoft: 1,2,3,4,5,6,8,7. Aprobación Especial fuera de alcance.
    const RULES = Object.freeze([
        { code:'1', name:'% de descuento', condition:'custbody_nso_fut_discount_rate', approved:'custbody_nso_fut_app_percent_discount' },
        { code:'2', name:'Precio específico', condition:'custbody_nso_fut_price_specific', approved:'custbody_nso_fut_app_specific_price' },
        { code:'3', name:'Días de crédito', condition:'custbody_nso_fut_days_credit', approved:'custbody_nso_fut_app_credit_days', first:'custbody_nso_aprobacion_dias_credito_2' },
        { code:'4', name:'Monto de crédito adicional', condition:'custbody_nso_fut_credit_add', approved:'custbody_nso_fut_app_additional_credit', first:'custbody_nso_aprob_monto_cred_ad_2' },
        { code:'5', name:'Días de vencimiento', condition:'custbody_nso_fut_expiration_days', approved:'custbody_nso_app_expiration_days' },
        { code:'6', name:'Nivel de precio / Venta contado', condition:'custbody_nos_fut_level_price', approved:'custbody_nso_fut_app_price_level' },
        { code:'8', name:'Ventas de taller', condition:'custbody_nso_fut_workshop_sales', approved:'custbody_nso_fut_app_workshop_sales' },
        { code:'7', name:'Crédito excedido', condition:'custbody_nos_fut_credit_exceeded', approved:'custbody_nso_app_credit_exceeded' }
    ]);
    const isOn = value => value === true || value === 'T';
    const get = (rec, fieldId) => rec.getValue({ fieldId });
    const put = (rec, fieldId, value) => rec.setValue({ fieldId, value });
    const num = (v, field) => {
        const n = Number(v);
        if (v === null || v === undefined || v === '' || !Number.isFinite(n)) {
            C.fail('Valor de cliente u orden no numérico en ' + field + '. No es seguro determinar las condiciones comerciales.');
        }
        return n;
    };
    const sel = v => Array.isArray(v) ? (v[0] ? String(v[0].value) : '')
        : v && typeof v === 'object' ? String(v.value || '') : String(v || '');
    const checked = rec => RULES.filter(r => isOn(get(rec, r.condition)));

    function blankHistory() { return { version:1, cycle:1, state:'active', done:{}, rejections:[] }; }
    function readHistory(rec) {
        const raw = get(rec, F.history);
        if (!raw) return blankHistory();
        try {
            const h = JSON.parse(String(raw));
            if (!h || h.version !== 1 || typeof h.done !== 'object' ||
                !h.done || !Array.isArray(h.rejections) || !['active','rejected','approved','closed'].includes(h.state)) {
                throw Error('Formato inesperado');
            }
            // Compatibilidad con OV creadas antes del módulo de historial.
            h.cycle = Number.isInteger(Number(h.cycle)) && Number(h.cycle) > 0
                ? Number(h.cycle) : 1;
            return h;
        } catch (e) { C.fail('No fue posible consultar el historial de autorizaciones. Contacte a soporte.'); }
    }
    function writeHistory(rec, h) { put(rec, F.history, JSON.stringify(h)); }

    function customerInfo(rec, cfg) {
        const entity = get(rec, 'entity');
        if (!entity) C.fail('La OV no tiene cliente; no se pueden evaluar condiciones comerciales.');
        let x;
        try {
            x = search.lookupFields({
                type:search.Type.CUSTOMER, id:entity,
                columns:['terms','pricelevel','daysoverdue','consolbalance','creditlimit']
            });
        } catch (e) {
            C.fail('No se pudieron consultar términos, precio o crédito del cliente ' + entity +
                '. Revise los permisos y campos de búsqueda. Detalle: ' + e.message);
        }
        const terms = sel(x.terms), price = sel(x.pricelevel);
        if (!terms || !price) C.fail('No se obtuvieron términos o nivel de precio del cliente ' + entity + '.');
        const total = num(get(rec,'total'), 'total de OV');
        const balance = num(x.consolbalance, 'consolbalance');
        const limit = num(x.creditlimit, 'creditlimit');
        const days = num(x.daysoverdue, 'daysoverdue');
        return { terms, price, total, balance, limit, days };
    }
    // Mismo concepto original de Netsoft, con limpieza de condiciones automáticas que ya no aplican.
    function refreshConditions(rec, cfg) {
        const x = customerInfo(rec, cfg);
        put(rec, 'custbody_nos_fut_level_price', x.terms !== cfg.baseTerms || x.price !== cfg.basePrice);
        put(rec, 'custbody_nos_fut_credit_exceeded', x.balance + x.total > x.limit);
        put(rec, 'custbody_nso_fut_expiration_days', x.days > 0);
        put(rec, 'custbody_nso_limite_credito', x.limit);
        put(rec, 'custbody_nso_limite_credito_actual', x.balance + x.total);
    }

    function matrix(code, subsidiary, cfg) {
        const parents = [];
        search.create({
            type:'customrecord_nso_approval_matrix',
            filters:[['isinactive','is','F'],'AND',
                ['custrecord_apm_subsidiary','anyof',String(subsidiary)],'AND',
                ['custrecord_apm_list_type_approval','anyof',String(code)]],
            columns:['internalid']
        }).run().each(row => { parents.push(String(row.id)); return true; });
        if (parents.length > 1) C.fail('Matrices duplicadas para condición ' + code + ' y subsidiaria ' + subsidiary + '.');
        if (!parents.length) return [];
        const result = {};
        search.create({
            type:'customrecord_nso_detail_apm',
            filters:[['isinactive','is','F'],'AND',
                ['custrecord_dapm_detail_approval','anyof',parents[0]]],
            columns:['custrecord_dapm_level_approval','custrecord_dapm_approval_alternate']
        }).run().each(row => {
            const lvl = Number(row.getValue({name:'custrecord_dapm_level_approval'}));
            const users = C.idList(row.getValue({name:'custrecord_dapm_approval_alternate'}));
            if (![1,2].includes(lvl)) C.fail('Nivel de matriz no soportado: ' + lvl + ' en condición ' + code);
            if (!result[lvl]) result[lvl] = new Set();
            users.forEach(id => result[lvl].add(id));
            return true;
        });
        if (result[2] && !result[1]) C.fail('Matriz sin nivel 1 para condición ' + code);
        return Object.keys(result).map(lvl => ({level:Number(lvl), users:[...result[lvl]]}))
            .sort((a,b) => a.level-b.level);
    }
    function stageList(rec, cfg) {
        const sub = get(rec,'subsidiary');
        if (!sub) C.fail('OV sin subsidiaria para evaluar la matriz.');
        return checked(rec).map(rule => {
            const levels = matrix(rule.code,sub,cfg);
            return {rule, levels};
        });
    }
    function nextStage(rec, cfg, hist) {
        if (hist.state === 'closed') return {blocked:true, reason:'Esta orden está cerrada definitivamente y no admite nuevas autorizaciones.'};
        if (hist.state === 'rejected') return {blocked:true, reason:'La orden fue rechazada. Debe corregirse y reenviarse a aprobación.'};
        const groups = stageList(rec,cfg);
        for (const group of groups) {
            if (!group.levels.length || group.levels.some(l => !l.users.length)) {
                return {blocked:true, reason:'No hay aprobadores activos configurados para ' + group.rule.name + '.', rule:group.rule};
            }
            for (const level of group.levels) {
                if (!(hist.done[group.rule.code] && hist.done[group.rule.code][level.level])) {
                    return {blocked:false, rule:group.rule, level:level.level, users:level.users};
                }
            }
        }
        return null;
    }
    function allDone(rec, cfg, h) {
        const stage = nextStage(rec,cfg,h);
        return stage === null;
    }
    function resetApprovals(rec, h, esCreacion) {
        const blank = blankHistory();
        blank.cycle = esCreacion ? 1 : (Number(h && h.cycle) || 1) + 1;
        blank.rejections = h && Array.isArray(h.rejections) ? h.rejections : [];
        for (const rule of RULES) {
            put(rec,rule.approved,false);
            if (rule.first) put(rec,rule.first,false);
        }
        put(rec,F.next,[]);
        put(rec,F.level,null);
        put(rec,F.reason,'');
        writeHistory(rec,blank);
        return blank;
    }
    function sync(rec,cfg,h) {
        // Los checkboxes son representación del historial validado, no fuente de autoridad.
        const active = checked(rec);
        const groups = active.map(rule => ({rule,levels:matrix(rule.code,get(rec,'subsidiary'),cfg)}));
        for (const rule of RULES) {
            const group = groups.find(g => g.rule.code === rule.code);
            const d = h.done[rule.code] || {};
            const allLevels = group && group.levels.length > 0 &&
                group.levels.every(l => !!d[l.level]);
            put(rec,rule.approved,!!allLevels);
            if (rule.first) put(rec,rule.first,!!(group && group.levels.length > 1 && d[1]));
        }
        const next = nextStage(rec,cfg,h);
        if (next && !next.blocked) {
            put(rec,F.next,next.users.map(Number));
            put(rec,F.level,String(next.level));
            put(rec,'orderstatus','A');
            h.state = 'active';
        } else if (next && next.blocked) {
            put(rec,F.next,[]);
            put(rec,F.level,null);
            put(rec,'orderstatus','A');
            if (h.state !== 'rejected') h.state = 'active';
        } else {
            put(rec,F.next,[]);
            put(rec,F.level,null);
            put(rec,'orderstatus','B');
            h.state = 'approved';
        }
        writeHistory(rec,h);
        return next;
    }
    const norm = v => v === null || v === undefined ? '' : String(v).trim();
    const lineFields = ['item','quantity','rate','price','amount'];
    function lineSnapshot(rec) {
        let n;
        try { n = rec.getLineCount({sublistId:'item'}); }
        catch(e) { return null; }
        const rows=[];
        for (let i=0; i<n; i++) {
            const a=[];
            for (const fieldId of lineFields) {
                let v='';
                try { v=rec.getSublistValue({sublistId:'item',fieldId,line:i}); } catch(e) {}
                a.push(norm(v));
            }
            rows.push(a);
        }
        return JSON.stringify(rows);
    }
    function changed(oldRec,newRec,partial) {
        if (!oldRec) return true;
        const monitored = ['entity','total'].concat(RULES.map(r=>r.condition));
        const fields = partial && newRec.getFields ? new Set(newRec.getFields()) : null;
        for (const fieldId of monitored) {
            if (fields && !fields.has(fieldId)) continue;
            if (norm(get(oldRec,fieldId)) !== norm(get(newRec,fieldId))) return true;
        }
        if (!partial) {
            const a=lineSnapshot(oldRec), b=lineSnapshot(newRec);
            if (a === null || b === null) C.fail('No fue posible comparar las líneas de la OV para determinar reaprobación.');
            if (a !== b) return true;
        }
        return false;
    }
    function approve(rec,cfg,userId) {
        const h=readHistory(rec);
        if (h.state === 'rejected') C.fail('La orden fue rechazada y no está disponible para aprobación.');
        if (get(rec,'orderstatus') !== 'A') C.fail('La orden ya no está pendiente de aprobación. Actualice su pantalla.');
        const actions=[];
        let previousCode='', previousLevel=0;
        // Conserva multi-aprobación si el usuario pertenece a matrices sucesivas,
        // pero no salta del nivel 1 al 2 de una misma condición en un solo clic.
        for (let i=0;i<16;i++) {
            const next=nextStage(rec,cfg,h);
            if (!next || next.blocked) break;
            if (!next.users.includes(String(userId))) break;
            if (next.rule.code===previousCode && next.level!==previousLevel) break;
            if (!h.done[next.rule.code]) h.done[next.rule.code]={};
            h.done[next.rule.code][next.level]={by:String(userId),at:new Date().toISOString()};
            actions.push(next.rule.name+' (nivel '+next.level+')');
            previousCode=next.rule.code; previousLevel=next.level;
        }
        if (!actions.length) C.fail('No está autorizado en la matriz vigente para el siguiente nivel o condición de esta orden.');
        sync(rec,cfg,h);
        return {actions, complete:allDone(rec,cfg,h)};
    }
    function reject(rec,cfg,userId,reason) {
        const h=readHistory(rec), next=nextStage(rec,cfg,h);
        if (get(rec,'orderstatus') !== 'A' || !next || next.blocked || !next.users.includes(String(userId))) {
            C.fail('No está autorizado para rechazar la condición pendiente. Actualice su pantalla.');
        }
        const text=String(reason||'').trim();
        if (text.length<5 || text.length>1000) C.fail('Indique un motivo de rechazo de 5 a 1000 caracteres.');
        h.rejections.push({by:String(userId),at:new Date().toISOString(),reason:text,condition:next.rule.code,level:next.level,cycle:h.cycle});
        h.rejections=h.rejections.slice(-30);
        h.done={}; h.state='rejected';
        RULES.forEach(r=>{ put(rec,r.approved,false); if(r.first)put(rec,r.first,false); });
        put(rec,F.reason,text); put(rec,F.level,null); put(rec,F.next,[]); put(rec,'orderstatus','A');
        writeHistory(rec,h);
        // El Netsoft original cierra todas las líneas al rechazar.
        // No hacerlo por defecto: activar sólo si negocio valida dicho comportamiento.
        if (cfg.closeOnReject) {
            const n=rec.getLineCount({sublistId:'item'});
            for (let i=0; i<n; i++) {
                rec.setSublistValue({sublistId:'item',fieldId:'isclosed',line:i,value:true});
            }
        }
        return {reason:text,closedLines:!!cfg.closeOnReject};
    }
    return {RULES,checked,readHistory,writeHistory,blankHistory,refreshConditions,matrix,
        nextStage,allDone,resetApprovals,sync,changed,approve,reject,isOn};
});

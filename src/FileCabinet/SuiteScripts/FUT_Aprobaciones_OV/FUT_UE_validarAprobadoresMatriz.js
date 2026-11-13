/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * FUT | Validación de aprobadores incluso en la edición nativa del detalle.
 * NUEVO (recomendado si los detalles de la matriz pueden editarse directamente).
 * Desplegar sobre customrecord_nso_detail_apm.
 */
define(['N/record','N/search','N/error',
        './FUT_MD_adminAprobaciones'],
    (record,search,error,A) => {
    const PARENT='customrecord_nso_approval_matrix';
    const DETAIL='customrecord_nso_detail_apm';
    const F={
        parent:'custrecord_dapm_detail_approval',
        subsidiary:'custrecord_nso_subsidiaria_line',
        level:'custrecord_dapm_level_approval',
        users:'custrecord_dapm_approval_alternate'
    };
    function fail(msg) {
        throw error.create({name:'FUT_APROBADORES_NO_AUTORIZADOS',
            message:msg,notifyOff:true});
    }
    const val=(r,id)=>r.getValue({fieldId:id});
    const str=v=>String(v===undefined || v===null?'':v);

    function beforeSubmit(ctx) {
        if (ctx.type===ctx.UserEventType.DELETE) return;
        const rec=ctx.newRecord;
        // Una actualización parcial no contiene todos los campos; no permitir
        // modificar aprobadores por edición inline ni submitFields.
        if (ctx.type===ctx.UserEventType.XEDIT) {
            const edited=rec.getFields() || [];
            if (edited.some(id=>[F.parent,F.subsidiary,F.level,F.users].includes(id))) {
                fail('Modifique los aprobadores desde Configurar Matrices o '
                    +'editando el registro completo; no se admite edición rápida.');
            }
            return;
        }
        if (val(rec,'isinactive')===true || val(rec,'isinactive')==='T') return;
        const parent=str(val(rec,F.parent));
        const sub=str(val(rec,F.subsidiary));
        const level=str(val(rec,F.level));
        if (!/^\d+$/.test(parent) || !/^\d+$/.test(sub) || !['1','2'].includes(level)) {
            fail('Debe indicar una matriz, subsidiaria y nivel (1 o 2) válidos.');
        }
        const matrix=record.load({type:PARENT,id:Number(parent),isDynamic:false});
        const expectedSub=str(val(matrix,'custrecord_apm_subsidiary'));
        if (!expectedSub || expectedSub!==sub) {
            fail('La subsidiaria del detalle debe coincidir con la de la matriz.');
        }
        if (ctx.oldRecord) {
            if (str(val(ctx.oldRecord,F.parent))!==parent ||
                str(val(ctx.oldRecord,F.subsidiary))!==sub ||
                str(val(ctx.oldRecord,F.level))!==level) {
                fail('No es posible cambiar la matriz, subsidiaria o nivel de un detalle existente.');
            }
        }
        const users=A.ids(val(rec,F.users));
        if (!users.length) {
            fail('Un detalle activo necesita al menos un aprobador. '
                +'Para retirar el último del nivel 2, desactive el detalle.');
        }
        const id=rec.id ? str(rec.id):'';
        const duplicates=search.create({
            type:DETAIL,
            filters:[['isinactive','is','F'],'AND',[F.parent,'anyof',parent],
                'AND',[F.level,'anyof',level]],
            columns:['internalid']
        }).run().getRange({start:0,end:1000}) || [];
        if (duplicates.some(r=>str(r.id)!==id)) {
            fail('Ya existe un detalle activo para este nivel de la matriz.');
        }
        // Los datos históricos no elegibles se pueden QUITAR progresivamente.
        // Se validan solo empleados nuevos; al crear un detalle, todos son nuevos.
        const previous=new Set(ctx.oldRecord?A.ids(val(ctx.oldRecord,F.users)):[]);
        for (const employee of users) {
            if (!previous.has(employee)) A.ensureEmployeeEligible(employee,sub);
        }
    }
    return {beforeSubmit};
});

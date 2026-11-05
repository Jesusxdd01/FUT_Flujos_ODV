/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * FUT | Consultas y operaciones de configuración de aprobaciones OV.
 * Biblioteca compartida, sin despliegue.
 */
define(['N/record','N/search','N/error','N/log',
        './FUT_MD_configAprobaciones'],
    (record, search, error, log, C) => {

    const PARENT = 'customrecord_nso_approval_matrix';
    const DETAIL = 'customrecord_nso_detail_apm';
    const PF = Object.freeze({
        subsidiary: 'custrecord_apm_subsidiary',
        condition: 'custrecord_apm_list_type_approval'
    });
    const DF = Object.freeze({
        parent: 'custrecord_dapm_detail_approval',
        subsidiary: 'custrecord_nso_subsidiaria_line',
        level: 'custrecord_dapm_level_approval',
        users: 'custrecord_dapm_approval_alternate'
    });
    // El motor actualmente reconoce las condiciones 1..8 y niveles 1..2.
    const ENGINE_CONDITIONS = ['1','2','3','4','5','6','7','8'];

    function fail(message) {
        throw error.create({
            name: 'CONFIGURACION_APROBACIONES_INVALIDA',
            message: message, notifyOff: true
        });
    }
    const field = (rec, id) => rec.getValue({fieldId: id});

    function ids(value) {
        const parts = Array.isArray(value) ? value :
            String(value === null || value === undefined ? '' : value)
                .split(/[\u0005,;\s]+/);
        return [...new Set(parts.map(x => String(x).trim())
            .filter(x => /^\d+$/.test(x) && Number(x) > 0))];
    }
    function requiredId(value, label) {
        const str = String(value === undefined || value === null ? '' : value).trim();
        if (!/^\d+$/.test(str) || Number(str) < 1) {
            fail('Seleccione un valor válido para ' + label + '.');
        }
        return str;
    }
    function getMatrix(matrixId) {
        const id = Number(requiredId(matrixId, 'matriz'));
        const rec = record.load({type: PARENT, id: id, isDynamic: false});
        if (field(rec,'isinactive') === true) {
            fail('Esta matriz está inactiva. Actualice la pantalla.');
        }
        return {
            id: String(id),
            subsidiary: String(field(rec, PF.subsidiary) || ''),
            condition: String(field(rec, PF.condition) || ''),
            details: detailRows(id)
        };
    }
    function detailRows(matrixId) {
        const rows = [];
        search.create({
            type: DETAIL,
            filters: [['isinactive','is','F'],'AND',
                [DF.parent,'anyof', String(matrixId)]],
            columns: ['internalid',DF.level,DF.users]
        }).run().each(row => {
            rows.push({
                id: String(row.id),
                level: String(row.getValue({name:DF.level}) || ''),
                users: ids(row.getValue({name:DF.users}))
            });
            return true;
        });
        return rows;
    }
    function listMatrices() {
        const output = [];
        search.create({
            type: PARENT,
            filters: [['isinactive','is','F']],
            columns: ['internalid', PF.subsidiary, PF.condition]
        }).run().each(row => {
            const sub = row.getValue({name: PF.subsidiary});
            const cond = row.getValue({name: PF.condition});
            output.push({
                id: String(row.id),
                subsidiary: String(sub || ''),
                subsidiaryText: String(row.getText({name:PF.subsidiary}) || sub || ''),
                condition: String(cond || ''),
                conditionText: String(row.getText({name:PF.condition}) || cond || '')
            });
            return true;
        });
        output.sort((a,b) => (a.subsidiaryText+'|'+a.conditionText)
            .localeCompare(b.subsidiaryText+'|'+b.conditionText,'es'));
        return output;
    }
    function ensureUnique(subsidiary, condition, ignoreId) {
        const found = [];
        search.create({
            type: PARENT,
            filters: [['isinactive','is','F'],'AND',
                [PF.subsidiary,'anyof',subsidiary],'AND',
                [PF.condition,'anyof',condition]],
            columns: ['internalid']
        }).run().each(row => { found.push(String(row.id)); return true; });
        const duplicates = found.filter(id => id !== String(ignoreId || ''));
        if (duplicates.length) {
            fail('Ya existe una matriz activa para la subsidiaria y condición ' +
                'seleccionadas. Edite la matriz existente.');
        }
    }
    function validateEmployees(list) {
        const union = [...new Set([...(list[1]||[]),...(list[2]||[])])];
        if (!union.length) fail('El nivel 1 necesita al menos un aprobador.');
        // Exige empleados activos, pero no cambia permisos ni matrices existentes.
        const found = new Set();
        const chunks = [];
        for (let i=0; i<union.length; i+=150) chunks.push(union.slice(i,i+150));
        for (const chunk of chunks) {
            search.create({
                type: search.Type.EMPLOYEE,
                filters: [['internalid','anyof',chunk],'AND',['isinactive','is','F']],
                columns: ['internalid']
            }).run().each(r => {found.add(String(r.id)); return true;});
        }
        const invalid = union.filter(id => !found.has(id));
        if (invalid.length) fail('Existen empleados inexistentes o inactivos: '+invalid.join(', '));
    }
    function saveDetail(matrixId, subsidiary, level, users, existing) {
        if (existing && existing.length > 1) {
            fail('La matriz tiene registros de detalle duplicados en nivel '+level+
                '. Revise los registros existentes antes de continuar.');
        }
        if (!users.length) {
            if (existing && existing.length === 1) {
                // Desactivar retiene notas de sistema y permite quitar nivel 2.
                const old = record.load({type: DETAIL, id: Number(existing[0].id)});
                old.setValue({fieldId:'isinactive',value:true});
                old.save({enableSourcing:false,ignoreMandatoryFields:false});
            }
            return;
        }
        const rec = existing && existing.length ?
            record.load({type: DETAIL,id:Number(existing[0].id),isDynamic:false}) :
            record.create({type: DETAIL,isDynamic:false});
        rec.setValue({fieldId:DF.parent,value:Number(matrixId)});
        rec.setValue({fieldId:DF.subsidiary,value:Number(subsidiary)});
        rec.setValue({fieldId:DF.level,value:Number(level)});
        // El campo es MULTISELECT. N/record espera un array, NO el
        // texto con separadores internos (\u0005) usado por algunas búsquedas.
        try {
            rec.setValue({fieldId:DF.users,value:users.map(String)});
        } catch (e) {
            log.error({title:'Campo de aprobadores rechazó la selección',
                details:JSON.stringify({matrixId,subsidiary,level,users,error:String(e.message||e)})});
            fail('No se pudo asignar la selección de aprobadores al nivel '+level+
                '. Verifique que los empleados estén activos y sean elegibles para la '
                +'subsidiaria de la matriz. El campo de NetSuite aplica un filtro por subsidiaria.');
        }
        rec.setValue({fieldId:'isinactive',value:false});
        rec.save({enableSourcing:false,ignoreMandatoryFields:false});
    }
    function saveMatrix(input) {
        const existingId = input.id ? requiredId(input.id, 'matriz') : '';
        const previous = existingId ? getMatrix(existingId) : null;
        // Una matriz existente conserva subsidiaria y tipo para no alterar
        // silenciosamente el destino de una autorización en curso.
        const subsidiary = previous ? previous.subsidiary :
            requiredId(input.subsidiary, 'subsidiaria');
        const condition = previous ? previous.condition :
            requiredId(input.condition, 'condición comercial');
        if (!ENGINE_CONDITIONS.includes(condition)) {
            fail('Esta condición aún no está soportada por el motor. ' +
                'No basta con agregarla a la lista; requiere lógica comercial.');
        }
        const levelUsers = {1:ids(input.level1), 2:ids(input.level2)};
        if (!levelUsers[1].length) fail('Seleccione al menos un aprobador para el nivel 1.');
        validateEmployees(levelUsers);
        ensureUnique(subsidiary,condition,existingId);
        const current = previous ? previous.details : [];
        const byLevel = {1:[],2:[]};
        for (const detail of current) {
            if (!byLevel[detail.level]) {
                fail('La matriz contiene un nivel no soportado: '+detail.level);
            }
            byLevel[detail.level].push(detail);
        }
        if (byLevel[1].length>1 || byLevel[2].length>1) {
            fail('La matriz ya tiene niveles duplicados. Revise sus detalles primero.');
        }
        // Nunca se modifica el campo de moneda u otros valores anteriores.
        let matrixId = existingId;
        let created = false;
        if (!matrixId) {
            const parent = record.create({type:PARENT,isDynamic:false});
            parent.setValue({fieldId:PF.subsidiary,value:Number(subsidiary)});
            parent.setValue({fieldId:PF.condition,value:Number(condition)});
            matrixId = String(parent.save({enableSourcing:false,ignoreMandatoryFields:false}));
            created = true;
        }
        try {
            saveDetail(matrixId,subsidiary,1,levelUsers[1],byLevel[1]);
            saveDetail(matrixId,subsidiary,2,levelUsers[2],byLevel[2]);
        } catch (e) {
            if (created) {
                // Una matriz recién creada incompleta NO debe quedar activa.
                try {record.submitFields({type:PARENT,id:Number(matrixId),
                    values:{isinactive:true},options:{enableSourcing:false}});} catch(ignore) {}
            }
            log.error({title:'Error guardando detalle de matriz',
                details:JSON.stringify({matrixId:matrixId,message:String(e.message||e)})});
            throw e;
        }
        log.audit({title:created?'Matriz creada':'Matriz actualizada',
            details:JSON.stringify({matrixId,subsidiary,condition,
                level1:levelUsers[1].length,level2:levelUsers[2].length})});
        return matrixId;
    }
    function deactivate(matrixId) {
        const old = getMatrix(matrixId);
        record.submitFields({type:PARENT,id:Number(old.id),
            values:{isinactive:true},options:{enableSourcing:false}});
        log.audit({title:'Matriz desactivada',details:JSON.stringify({id:old.id})});
    }
    function formsAvailable() {
        // La lista real de formularios de OV, sin valores codificados a mano.
        const so = record.create({type:record.Type.SALES_ORDER,isDynamic:true});
        const nativeField = so.getField({fieldId:'customform'});
        if (!nativeField || typeof nativeField.getSelectOptions !== 'function') {
            fail('No fue posible consultar los formularios de órdenes de venta.');
        }
        const options = nativeField.getSelectOptions({filter:'',operator:'contains'}) || [];
        const mapped = options.filter(o => /^\d+$/.test(String(o.value)) && Number(o.value)>0)
            .map(o => ({value:String(o.value),text:String(o.text||o.value)}));
        if (!mapped.length) {
            fail('NetSuite no devolvió los formularios de órdenes de venta. ' +
                'Revise el acceso a los formularios y la preferencia de máximo de opciones desplegables.');
        }
        mapped.sort((a,b)=>a.text.localeCompare(b.text,'es'));
        return mapped;
    }
    function getFlow() {
        const id = C.getUniqueId();
        const rec = record.load({type:C.CFG,id:id,isDynamic:false});
        return {id:id, enabled:C.isOn(field(rec,C.FIELD.enabled)),
            initial: ids(field(rec,C.FIELD.initial)),
            reapprove: ids(field(rec,C.FIELD.reapprove)),
            excluded: ids(field(rec,C.FIELD.excluded))};
    }
    function saveFlow(input) {
        // Se consulta nuevamente, sin aceptar un ID de configuración del cliente.
        const current = getFlow();
        if (!current.enabled) fail('CONFIG_UNICA está deshabilitada. Habilítela desde el registro.');
        const allowed = new Set(formsAvailable().map(x=>x.value));
        const initial = ids(input.initial);
        const reapprove = ids(input.reapprove);
        const excluded = ids(input.excluded);
        if (!initial.length || !reapprove.length) {
            fail('Seleccione al menos un formulario para aprobación inicial y para reaprobación.');
        }
        for (const id of [...initial,...reapprove,...excluded]) {
            if (!allowed.has(id)) fail('El formulario '+id+' no está disponible para selección.');
        }
        if (initial.some(x=>excluded.includes(x)) ||
            reapprove.some(x=>excluded.includes(x))) {
            fail('Un formulario no puede estar incluido y excluido al mismo tiempo.');
        }
        const rec = record.load({type:C.CFG,id:current.id,isDynamic:false});
        rec.setValue({fieldId:C.FIELD.initial,value:initial.join(',')});
        rec.setValue({fieldId:C.FIELD.reapprove,value:reapprove.join(',')});
        rec.setValue({fieldId:C.FIELD.excluded,value:excluded.join(',')});
        // NO tocar: término base, nivel de precio, estado habilitado, cierre/rechazo.
        rec.save({enableSourcing:false,ignoreMandatoryFields:false});
        log.audit({title:'Formularios del flujo actualizados',details:JSON.stringify({
            config:current.id,initial,reapprove,excluded})});
        return current.id;
    }

    // Empleados elegibles por subsidiaria; el campo multiselect de Netsoft
    // custrecord_dapm_approval_alternate está filtrado por STDENTITYSUBSIDIARY.
    // Esta selección evita ofrecer empleados de otra subsidiaria.
    function eligibleEmployees(subsidiary) {
        const sub=requiredId(subsidiary,'subsidiaria');
        const rows=[];
        search.create({
            type: search.Type.EMPLOYEE,
            filters: [['isinactive','is','F'],'AND',['subsidiary','anyof',sub]],
            columns: ['internalid','entityid']
        }).run().each(r=>{
            rows.push({id:String(r.id),name:String(r.getValue({name:'entityid'}) || ('Empleado '+r.id))});
            return true;
        });
        rows.sort((a,b)=>a.name.localeCompare(b.name,'es'));
        return rows;
    }
    function ensureEmployeeEligible(employeeId,subsidiary) {
        const employee=requiredId(employeeId,'empleado');
        const sub=requiredId(subsidiary,'subsidiaria');
        const found=search.create({
            type: search.Type.EMPLOYEE,
            filters:[['internalid','anyof',employee],'AND',
                ['isinactive','is','F'],'AND',['subsidiary','anyof',sub]],
            columns:['internalid']
        }).run().getRange({start:0,end:1}) || [];
        if (!found.length) {
            fail('El empleado seleccionado no está activo o no está asociado a la '
                +'subsidiaria de esta matriz. Seleccione un aprobador de la lista disponible.');
        }
    }
    // Actualizar SOLO el nivel afectado, manteniendo intactos los demás.
    // Regrabar niveles sin cambios puede fallar al revalidar filtros heredados.
    function updateSingleLevel(matrix,level,users) {
        const existing=matrix.details.filter(d=>d.level===String(level));
        if (existing.length>1) fail('Hay detalles duplicados para el nivel '+level+'.');
        if (String(level)==='1' && !users.length) {
            fail('El nivel 1 debe conservar al menos un aprobador.');
        }
        try {
            saveDetail(matrix.id,matrix.subsidiary,Number(level),ids(users),existing);
        } catch (e) {
            log.error({title:'No se pudo modificar el nivel de la matriz',
                details:JSON.stringify({matriz:matrix.id,nivel:level,users,error:String(e.message||e)})});
            if (e.name==='CONFIGURACION_APROBACIONES_INVALIDA') throw e;
            fail('No se pudieron guardar los aprobadores. El campo está filtrado '
                +'por subsidiaria; revise la elegibilidad de los empleados, incluso '
                +'los que ya estaban asignados. Detalle: '+String(e.message||e));
        }
    }

    // ============================================================
    // ADMINISTRACIÓN GRANULAR: UN EMPLEADO POR OPERACIÓN
    // ============================================================
    function employeesById(employeeIds) {
        const result = {};
        const selected = ids(employeeIds);
        for (let start=0; start<selected.length; start+=100) {
            const group = selected.slice(start,start+100);
            search.create({
                type: search.Type.EMPLOYEE,
                filters: [['internalid','anyof',group]],
                columns: ['internalid','entityid','firstname','lastname','isinactive']
            }).run().each(row => {
                const id=String(row.id);
                const name=String(row.getValue({name:'entityid'}) ||
                    [row.getValue({name:'firstname'}),row.getValue({name:'lastname'})]
                        .filter(Boolean).join(' ') || ('Empleado '+id));
                const inactive=row.getValue({name:'isinactive'});
                result[id]={id,name,inactive:inactive===true || inactive==='T'};
                return true;
            });
        }
        for (const id of selected) {
            if (!result[id]) result[id]={id,name:'Empleado '+id+' (no disponible)',inactive:true};
        }
        return result;
    }
    function levelUsers(matrix, level) {
        return [...new Set(matrix.details.filter(d=>d.level===String(level))
            .flatMap(d=>d.users))];
    }
    function addMatrixEmployee(matrixId, levelValue, employeeValue) {
        const level=requiredId(levelValue,'nivel');
        if (level!=='1' && level!=='2') fail('Solamente se admiten los niveles 1 y 2.');
        const employee=requiredId(employeeValue,'empleado');
        const matrix=getMatrix(matrixId);
        const u1=levelUsers(matrix,1);
        const u2=levelUsers(matrix,2);
        const target=level==='1'?u1:u2;
        if (target.includes(employee)) {
            fail('El empleado ya pertenece al nivel '+level+' de esta matriz.');
        }
        ensureEmployeeEligible(employee,matrix.subsidiary);
        target.push(employee);
        updateSingleLevel(matrix,level,target);
        log.audit({title:'Aprobador agregado',details:JSON.stringify({matrixId:matrix.id,level,employee})});
        return matrix.id;
    }
    function removeMatrixEmployee(matrixId, levelValue, employeeValue) {
        const level=requiredId(levelValue,'nivel');
        if (level!=='1' && level!=='2') fail('Nivel no válido.');
        const employee=requiredId(employeeValue,'empleado');
        const matrix=getMatrix(matrixId);
        const u1=levelUsers(matrix,1);
        const u2=levelUsers(matrix,2);
        const current=level==='1'?u1:u2;
        if (!current.includes(employee)) {
            fail('El empleado ya no forma parte del nivel seleccionado. Actualice la pantalla.');
        }
        const changed=current.filter(id=>id!==employee);
        if (level==='1' && changed.length===0) {
            fail('El nivel 1 debe conservar al menos un aprobador. Agregue un reemplazo antes de quitar al último.');
        }
        updateSingleLevel(matrix,level,changed);
        log.audit({title:'Aprobador retirado',details:JSON.stringify({matrixId:matrix.id,level,employee})});
        return matrix.id;
    }
    function createMatrixForEmployee(subsidiary, condition, employee) {
        const who=requiredId(employee,'empleado inicial');
        ensureEmployeeEligible(who,subsidiary);
        return saveMatrix({
            subsidiary:subsidiary,
            condition:condition,
            level1:[who],
            level2:[]
        });
    }

    // ============================================================
    // CONFIGURAR FLUJO: AÑADIR O QUITAR UN FORMULARIO
    // ============================================================
    const FLOW_GROUPS=Object.freeze({
        initial:'Aprobación inicial',
        reapprove:'Reaprobación',
        excluded:'Formularios excluidos'
    });
    function ensureFlowGroup(group) {
        if (!Object.prototype.hasOwnProperty.call(FLOW_GROUPS,group)) {
            fail('La lista de formularios seleccionada no es válida.');
        }
        return group;
    }
    function addFlowForm(formValue, groupValue) {
        const group=ensureFlowGroup(groupValue);
        const formId=requiredId(formValue,'formulario');
        const current=getFlow();
        const updated={
            initial:[...current.initial],
            reapprove:[...current.reapprove],
            excluded:[...current.excluded]
        };
        if (updated[group].includes(formId)) {
            fail('Este formulario ya existe en '+FLOW_GROUPS[group]+'.');
        }
        updated[group].push(formId);
        saveFlow(updated); // Revalida formularios, exclusiones y configuración única.
    }
    function removeFlowForm(formValue, groupValue) {
        const group=ensureFlowGroup(groupValue);
        const formId=requiredId(formValue,'formulario');
        const current=getFlow();
        const updated={
            initial:[...current.initial],
            reapprove:[...current.reapprove],
            excluded:[...current.excluded]
        };
        if (!updated[group].includes(formId)) {
            fail('Este formulario ya no está en la lista seleccionada. Actualice la página.');
        }
        updated[group]=updated[group].filter(id=>id!==formId);
        saveFlow(updated); // No permite dejar vacías las listas inicial/reaprobación.
    }

    return {ids,fail,listMatrices,getMatrix,saveMatrix,deactivate,
        formsAvailable,getFlow,saveFlow,employeesById,levelUsers,
        addMatrixEmployee,removeMatrixEmployee,createMatrixForEmployee,eligibleEmployees,
        addFlowForm,removeFlowForm,FLOW_GROUPS};
});

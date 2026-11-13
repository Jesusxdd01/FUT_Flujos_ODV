/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * Configuración de matrices de aprobación (administración por empleado).
 * Script ID: customscript_fut_sl_cfg_matrices
 * Deployment ID: customdeploy_fut_sl_cfg_matrices
 * Restringir el despliegue al rol administrador desde Audience.
 */
define([
    'N/ui/serverWidget','N/ui/message','N/url','N/redirect','N/log',
    './FUT_MD_adminAprobaciones'
], (ui,message,url,redirect,log,A) => {
    const SCRIPT='customscript_fut_sl_cfg_matrices';
    const DEPLOY='customdeploy_fut_sl_cfg_matrices';
    const p=(req,name)=>String(req.parameters[name] || '');

    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/\"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function editAnchor(href) {
        return '<a href="'+esc(href)+'" target="_self">Editar</a>';
    }
    function removeAnchor(mid,level,employee) {
        return '<a href="#" data-fut-action="removeEmployee" data-fut-mid="'+esc(mid)+
            '" data-fut-level="'+esc(level)+'" data-fut-employee="'+esc(employee)+
            '">Quitar</a>';
    }
    function attachClient(form) {
        form.clientScriptModulePath='./FUT_CS_adminAprobaciones.js';
    }
    function backButton(form) {
        form.addButton({id:'custpage_volver',label:'Volver al listado',
            functionName:'futVolverMatrices'});
    }
    function path(params) {
        return url.resolveScript({scriptId:SCRIPT,deploymentId:DEPLOY,
            params:params || {},returnExternalUrl:false});
    }
    function go(params) {
        redirect.toSuitelet({scriptId:SCRIPT,deploymentId:DEPLOY,
            parameters:params || {mode:'list'}});
    }
    function back(form,label,params) {
        form.addPageLink({type:ui.FormPageLinkType.CROSSLINK,
            title:label,url:path(params)});
    }
    function hidden(form,id,value) {
        const f=form.addField({id,type:ui.FieldType.TEXT,label:'Control'});
        f.defaultValue=String(value === undefined || value === null ? '' : value);
        f.updateDisplayType({displayType:ui.FieldDisplayType.HIDDEN});
    }
    function inline(form,id,label,value) {
        const f=form.addField({id,type:ui.FieldType.TEXT,label});
        f.defaultValue=String(value || '');
        f.updateDisplayType({displayType:ui.FieldDisplayType.INLINE});
    }
    function errorBanner(form,msg) {
        if (msg) form.addPageInitMessage({type:message.Type.ERROR,
            title:'No se pudo completar la operación',message:String(msg),duration:0});
    }
    function cell(list,id,row,value) {
        const v=String(value === undefined || value === null ? '' : value);
        if (v) list.setSublistValue({id,line:row,value:v});
    }
    function matrixLabels(id,matrix) {
        const row=A.listMatrices().find(m=>m.id===String(id));
        return {
            subsidiary:row ? row.subsidiaryText : matrix.subsidiary,
            condition:row ? row.conditionText : matrix.condition
        };
    }

    // ==========================================================
    // PANTALLA PRINCIPAL: CONSERVA FILTROS Y LISTADO
    // ==========================================================
    function listPage(ctx,filters,err) {
        const form=ui.createForm({title:'Configuración de matrices de aprobación'});
        attachClient(form);
        form.addButton({id:'custpage_nueva',label:'Nueva matriz',
            functionName:'futNuevaMatriz'});
        errorBanner(form,err);
        hidden(form,'custpage_mode','filter');

        const sub=form.addField({id:'custpage_fsub',
            type:ui.FieldType.SELECT,label:'Filtrar por subsidiaria',source:'subsidiary'});
        const cond=form.addField({id:'custpage_fcond',
            type:ui.FieldType.SELECT,label:'Filtrar por condición',
            source:'customlist_apm_list_type_approval'});
        if (filters.sub) sub.defaultValue=String(filters.sub);
        if (filters.cond) cond.defaultValue=String(filters.cond);
        form.addSubmitButton({label:'Aplicar filtros'});

        const list=form.addSublist({id:'custpage_matrices',
            type:ui.SublistType.LIST,label:'Matrices activas'});
        list.addField({id:'custpage_edit',type:ui.FieldType.TEXT,label:'Acción'});
        list.addField({id:'custpage_sub',type:ui.FieldType.TEXT,label:'Subsidiaria'});
        list.addField({id:'custpage_cond',type:ui.FieldType.TEXT,label:'Condición comercial'});
        list.addField({id:'custpage_n1',type:ui.FieldType.INTEGER,label:'Aprobadores nivel 1'});
        list.addField({id:'custpage_n2',type:ui.FieldType.INTEGER,label:'Aprobadores nivel 2'});

        const rows=A.listMatrices().filter(row=>
            (!filters.sub || row.subsidiary===filters.sub) &&
            (!filters.cond || row.condition===filters.cond));
        rows.forEach((row,i)=>{
            const matrix=A.getMatrix(row.id);
            cell(list,'custpage_edit',i,editAnchor(path({mode:'edit',custom_matrix_id:row.id})));
            cell(list,'custpage_sub',i,row.subsidiaryText || row.subsidiary);
            cell(list,'custpage_cond',i,row.conditionText || row.condition);
            cell(list,'custpage_n1',i,String(A.levelUsers(matrix,1).length));
            cell(list,'custpage_n2',i,String(A.levelUsers(matrix,2).length));
        });
        ctx.response.writePage(form);
    }

    // ==========================================================
    // CREAR MATRIZ: N1 REQUIERE APROBADOR INICIAL
    // ==========================================================
    function createPage(ctx,values,err) {
        const form=ui.createForm({title:'Nueva matriz de aprobación'});
        attachClient(form);
        backButton(form);
        errorBanner(form,err);
        hidden(form,'custpage_mode','create');
        const subsidiary=form.addField({id:'custpage_subsidiary',
            type:ui.FieldType.SELECT,label:'Subsidiaria',source:'subsidiary'});
        const cond=form.addField({id:'custpage_condition',
            type:ui.FieldType.SELECT,label:'Condición comercial',
            source:'customlist_apm_list_type_approval'});
        const employee=form.addField({id:'custpage_employee',
            type:ui.FieldType.SELECT,label:'Primer aprobador (nivel 1)'});
        employee.addSelectOption({value:'',text:'Seleccione un empleado'});
        const selectedSub=String(values && values.subsidiary || '');
        const employeeOptions=selectedSub?A.eligibleEmployees(selectedSub):[];
        if (selectedSub) {
            employeeOptions.forEach(opt=>{
                employee.addSelectOption({value:opt.id,
                    text:opt.name+(opt.source==='principal'?' (subsidiaria principal)':'')});
            });
        }
        subsidiary.isMandatory=true;
        cond.isMandatory=true;
        employee.isMandatory=true;
        if (values) {
            if (values.subsidiary) subsidiary.defaultValue=values.subsidiary;
            if (values.condition) cond.defaultValue=values.condition;
            if (values.employee && employeeOptions.some(o=>o.id===values.employee)) {
                employee.defaultValue=values.employee;
            }
        }
        form.addSubmitButton({label:'Crear matriz'});
        ctx.response.writePage(form);
    }

    // ==========================================================
    // EDITAR MATRIZ: AGREGAR UNO + 2 LISTAS DE APROBADORES
    // ==========================================================
    function editPage(ctx,matrixId,err) {
        const matrix=A.getMatrix(matrixId);
        const labels=matrixLabels(matrix.id,matrix);
        const form=ui.createForm({title:'Editar matriz de aprobación'});
        attachClient(form);
        backButton(form);
        form.addButton({id:'custpage_desactivar',label:'Desactivar matriz',
            functionName:'futDesactivarMatriz'});
        errorBanner(form,err);
        hidden(form,'custpage_mode','addEmployee');
        hidden(form,'custpage_mid',matrix.id);

        inline(form,'custpage_subtxt','Subsidiaria',labels.subsidiary);
        inline(form,'custpage_condtxt','Condición comercial',labels.condition);
        const group=form.addFieldGroup({id:'custpage_groupadd',
            label:'Agregar aprobador'});
        const employee=form.addField({id:'custpage_employee',
            type:ui.FieldType.SELECT,label:'Empleado a agregar',
            container:'custpage_groupadd'});
        employee.addSelectOption({value:'',text:'Seleccione un empleado'});
        A.eligibleEmployees(matrix.subsidiary).forEach(opt=>
            employee.addSelectOption({value:opt.id,
                text:opt.name+(opt.source==='principal'?' (subsidiaria principal)':'')}));
        const level=form.addField({id:'custpage_level',
            type:ui.FieldType.SELECT,label:'Nivel',container:'custpage_groupadd'});
        level.addSelectOption({value:'1',text:'Nivel 1',isSelected:true});
        level.addSelectOption({value:'2',text:'Nivel 2'});
        employee.isMandatory=true;
        level.isMandatory=true;
        form.addSubmitButton({label:'Agregar aprobador'});

        const allIds=[...new Set([...A.levelUsers(matrix,1),...A.levelUsers(matrix,2)])];
        const names=A.employeesById(allIds);
        [1,2].forEach(n=>{
            const list=form.addSublist({id:'custpage_members'+n,
                type:ui.SublistType.LIST,
                label:'Aprobadores nivel '+n+' ('+A.levelUsers(matrix,n).length+')'});
            list.addField({id:'custpage_name',type:ui.FieldType.TEXT,label:'Empleado'});
            list.addField({id:'custpage_remove',
                type:ui.FieldType.TEXT,label:'Acción'});
            const members=A.levelUsers(matrix,n).sort((a,b)=>
                String(names[a].name).localeCompare(String(names[b].name),'es'));
            members.forEach((id,i)=>{
                const label=names[id].name+(names[id].inactive?' (inactivo)':'');
                cell(list,'custpage_name',i,label);
                cell(list,'custpage_remove',i,removeAnchor(matrix.id,n,id));
            });
        });
        ctx.response.writePage(form);
    }

    function onRequest(ctx) {
        const req=ctx.request;
        try {
            if (req.method==='POST' && /^application\/json/i.test(String(
                    (req.headers && (req.headers['content-type'] || req.headers['Content-Type'])) || ''))) {
                let body={};
                try {body=JSON.parse(req.body||'{}');}
                catch(e) {body={};}
                let reply;
                try {
                    if (body.fut_ajax !== true) A.fail('Solicitud inválida.');
                    if (body.action==='removeEmployee') {
                        A.removeMatrixEmployee(body.mid,body.level,body.employee);
                    } else if (body.action==='disableMatrix') {
                        A.deactivate(body.mid);
                    } else A.fail('Acción no permitida.');
                    reply={ok:true};
                } catch(e) {
                    log.error({title:'No se completó la acción de matriz',details:String(e.stack||e)});
                    reply={ok:false,message:String(e.message||e)};
                }
                ctx.response.setHeader({name:'Content-Type',value:'application/json; charset=UTF-8'});
                ctx.response.write(JSON.stringify(reply));
                return;
            }
            if (req.method==='POST') {
                const action=p(req,'custpage_mode');
                if (action==='filter') {
                    listPage(ctx,{sub:p(req,'custpage_fsub'),cond:p(req,'custpage_fcond')});
                    return;
                }
                if (action==='create') {
                    const values={subsidiary:p(req,'custpage_subsidiary'),
                        condition:p(req,'custpage_condition'),employee:p(req,'custpage_employee')};
                    try {
                        const mid=A.createMatrixForEmployee(values.subsidiary,
                            values.condition,values.employee);
                        go({mode:'edit',custom_matrix_id:mid});
                    } catch(e) {
                        log.error({title:'No se pudo crear matriz',details:String(e.stack||e)});
                        createPage(ctx,values,String(e.message||e));
                    }
                    return;
                }
                if (action==='addEmployee') {
                    const mid=p(req,'custpage_mid');
                    try {
                        A.addMatrixEmployee(mid,p(req,'custpage_level'),
                            p(req,'custpage_employee'));
                        go({mode:'edit',custom_matrix_id:mid});
                    } catch(e) {
                        log.error({title:'No se pudo agregar aprobador',details:String(e.stack||e)});
                        editPage(ctx,mid,String(e.message||e));
                    }
                    return;
                }
                if (action==='removeEmployee') {
                    const mid=p(req,'custpage_mid');
                    try {
                        A.removeMatrixEmployee(mid,p(req,'custpage_level'),
                            p(req,'custpage_employee'));
                        go({mode:'edit',custom_matrix_id:mid});
                    } catch(e) {
                        log.error({title:'No se pudo quitar aprobador',details:String(e.stack||e)});
                        editPage(ctx,mid,String(e.message||e));
                    }
                    return;
                }
                if (action==='disable') {
                    A.deactivate(p(req,'custpage_mid'));
                    go({mode:'list'});
                    return;
                }
                A.fail('Acción no reconocida.');
            }
            const mode=p(req,'mode') || 'list';
            if (mode==='list') listPage(ctx,{sub:'',cond:''});
            else if (mode==='new') createPage(ctx,{
                subsidiary:p(req,'custom_subsidiary'),
                condition:p(req,'custom_condition')});
            else if (mode==='edit') editPage(ctx,p(req,'custom_matrix_id'));
            else A.fail('Pantalla desconocida.');
        } catch(e) {
            log.error({title:'Error al configurar matrices',details:String(e.stack||e)});
            const form=ui.createForm({title:'Configuración de matrices de aprobación'});
            back(form,'Volver al listado',{mode:'list'});
            errorBanner(form,String(e.message||e));
            ctx.response.writePage(form);
        }
    }
    return {onRequest};
});

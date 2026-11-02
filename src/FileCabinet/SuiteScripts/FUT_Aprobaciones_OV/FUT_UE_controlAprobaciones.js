/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * FUT | Control de aprobaciones y reaprobaciones
 *
 * Script: customscript_fut_ue_ordenAprob
 * Deploy: customdeploy_fut_ue_ordenAprob
 *
 */

define([
    'N/record',
    'N/runtime',
    'N/error',
    'N/log',
    'N/ui/message',
    './FUT_MD_configAprobaciones',
    './FUT_MD_motorAprobaciones'
], (
    record,
    runtime,
    error,
    log,
    message,
    C,
    M
) => {

    const F = C.F;

    const eq = (a, b) =>
        String(a === null || a === undefined ? '' : a) ===
        String(b === null || b === undefined ? '' : b);

    const is = (ctx, which) =>
        ctx.type === ctx.UserEventType[which];

    const nonTender = rec =>
        !M.isOn(rec.getValue({
            fieldId: 'custbody_licitacion'
        }));

    const controlled = (rec, cfg) =>
        nonTender(rec) && C.applies(rec, cfg, 'initial');

    const reapproval = (rec, cfg) =>
        nonTender(rec) && C.applies(rec, cfg, 'reapprove');


    // =====================================================
    // 1. BLOQUEO DE APROBACIÓN NATIVA
    // =====================================================

    
    function nativeBlocked(rec) {

        const tranid = rec.getValue({
            fieldId: 'tranid'
        }) || rec.id || '';

        throw error.create({
            name: 'APROBACION_COMERCIAL_REQUERIDA',
            message:
                'La orden ' + tranid +
                ' requiere aprobación comercial. ' +
                'No es posible autorizarla desde esta lista. ' +
                'Abre la orden de venta y utiliza el botón ' +
                'Aprobar para completar las autorizaciones correspondientes.',
            notifyOff: true
        });
    }



    // =====================================================
    // 2. BEFORE LOAD
    // DIAGNÓSTICO DE BOTONES Y MATRICES
    // =====================================================

   
function beforeLoad(ctx) {

    if (!is(ctx, 'VIEW')) {
        return;
    }

    const cfg = C.get();
    const usuario = String(runtime.getCurrentUser().id);

    // Recuperar la OV persistida para obtener el
    // formulario real y los datos de aprobación.
    const rec = record.load({
        type: record.Type.SALES_ORDER,
        id: ctx.newRecord.id,
        isDynamic: false
    });

    const formularioContexto =
        ctx.newRecord.getValue({
            fieldId: 'customform'
        });

    const formularioGuardado =
        rec.getValue({
            fieldId: 'customform'
        });

    const estado = String(
        rec.getValue({
            fieldId: 'orderstatus'
        }) || ''
    );

    const aplica = controlled(rec, cfg);

    // DIAGNÓSTICO 1
    log.audit({
        title: 'FUT BL 01 FORMULARIO',
        details: JSON.stringify({
            orden: rec.id,
            formularioContexto: formularioContexto,
            formularioGuardado: formularioGuardado,
            estado: estado,
            usuario: usuario,
            aplica: aplica,
            formularios: cfg.initial
        })
    });

    if (!aplica || estado !== 'A') {
        return;
    }

    // Obtener condición pendiente y aprobadores vigentes.
    const historia = M.readHistory(rec);

    const next = M.nextStage(
        rec,
        cfg,
        historia
    );

    const aprobadores =
        next && next.users
            ? next.users.map(String)
            : [];

    const autorizado =
        aprobadores.includes(usuario);

    // DIAGNÓSTICO 2
    log.audit({
        title: 'FUT BL 02 MATRIZ',
        details: JSON.stringify({
            orden: rec.id,
            usuario: usuario,
            condicion: next && next.rule
                ? next.rule.code
                : null,
            nombre: next && next.rule
                ? next.rule.name
                : null,
            nivel: next ? next.level : null,
            aprobadores: aprobadores,
            bloqueado: next ? next.blocked : null,
            motivo: next ? next.reason : null,
            autorizado: autorizado
        })
    });

    if (next && next.blocked) {

        ctx.form.addPageInitMessage({
            type: message.Type.WARNING,
            title: 'Aprobación FUT pendiente',
            message: next.reason,
            duration: 10000
        });

        return;
    }

    if (!next || !autorizado) {
        return;
    }

    // Asociar el Client Script.
    ctx.form.clientScriptModulePath =
        './FUT_CS_accionesAprobacion.js';

    // Botón Aprobar.
    ctx.form.addButton({
        id: 'custpage_fut_aprobar',
        label: 'Aprobar',
        functionName:
            'futAprobar(' + Number(rec.id) + ')'
    });

    // Botón Rechazar.
    ctx.form.addButton({
        id: 'custpage_fut_rechazar',
        label: 'Rechazar',
        functionName:
            'futRechazar(' + Number(rec.id) + ')'
    });

    // DIAGNÓSTICO 3
    log.audit({
        title: 'FUT BL 03 BOTONES',
        details: JSON.stringify({
            orden: rec.id,
            usuario: usuario,
            botonesCreados: true
        })
    });
}



    // =====================================================
    // 3. BEFORE SUBMIT
    // CONTROL DE APROBACIONES Y REAPROBACIONES
    // =====================================================

    function beforeSubmit(ctx) {

        const rec = ctx.newRecord;
        const old = ctx.oldRecord;
        const cfg = C.get();
        const event = ctx.type;


        // ---------------------------------------------
        // Bloquear aprobación/rechazo nativo
        // ---------------------------------------------

        if (
            is(ctx, 'APPROVE') ||
            is(ctx, 'REJECT')
        ) {

            const base = old || rec;

            if (
                controlled(base, cfg) &&
                M.checked(base).length
            ) {
                nativeBlocked(base);
            }

            return;
        }


        // ---------------------------------------------
        // Controlar edición en línea
        // ---------------------------------------------

        if (is(ctx, 'XEDIT')) {

            const stored = record.load({
                type: record.Type.SALES_ORDER,
                id: rec.id,
                isDynamic: false
            });

            if (
                !controlled(stored, cfg) &&
                !reapproval(stored, cfg)
            ) {
                return;
            }

            const unsafe = new Set(
                [
                    'entity',
                    'total',
                    'customform',
                    'orderstatus',
                    F.history,
                    F.level,
                    F.next
                ]
                .concat(
                    M.RULES.map(r => r.condition)
                )
                .concat(
                    M.RULES.flatMap(r =>
                        [r.approved].concat(
                            r.first ? [r.first] : []
                        )
                    )
                )
            );

            if (
                rec.getFields().some(
                    id => unsafe.has(id)
                )
            ) {

                C.fail(
                    'La edición en línea de cliente, ' +
                    'importes, formularios o campos ' +
                    'de aprobación no está permitida. ' +
                    'Abra la OV en edición completa.'
                );
            }

            return;
        }


        // ---------------------------------------------
        // Solo creación y edición
        // ---------------------------------------------

        if (
            !is(ctx, 'CREATE') &&
            !is(ctx, 'EDIT')
        ) {
            return;
        }


        const nowInit = controlled(rec, cfg);

        const nowReap = reapproval(rec, cfg);

        const previouslyControlled =
            old && (
                controlled(old, cfg) ||
                reapproval(old, cfg)
            );


        // ---------------------------------------------
        // Evitar cambio a formulario no controlado
        // ---------------------------------------------

        if (
            previouslyControlled &&
            !nowInit &&
            !nowReap
        ) {

            C.fail(
                'No se permite trasladar esta orden ' +
                'a un formulario fuera del control FUT ' +
                'mediante edición ordinaria. ' +
                'Consulte al administrador.'
            );
        }


        if (!nowInit && !nowReap) {
            return;
        }


        // ---------------------------------------------
        // Determinar creación o cambios comerciales
        // ---------------------------------------------

        const create = is(ctx, 'CREATE');

        const changed =
            create ||
            (
                old &&
                nowReap &&
                M.changed(old, rec, false)
            );


        // ---------------------------------------------
        // Inicio / Reinicio de aprobaciones
        // ---------------------------------------------

        if (changed) {

            const previous = create
                ? M.blankHistory()
                : M.readHistory(rec);

            M.resetApprovals(
                rec,
                previous
            );

            M.refreshConditions(
                rec,
                cfg
            );

            M.sync(
                rec,
                cfg,
                M.readHistory(rec)
            );


            log.audit({
                title: 'FUT Inicio/Reaprobación',

                details: JSON.stringify({
                    id: rec.id || null,

                    tranid: rec.getValue({
                        fieldId: 'tranid'
                    }),

                    evento: event,

                    form: rec.getValue({
                        fieldId: 'customform'
                    }),

                    condiciones:
                        M.checked(rec).map(
                            x => x.code
                        )
                })
            });

            return;
        }


        if (!old || !nowInit) {
            return;
        }


        // ---------------------------------------------
        // Validación de modificaciones a autorizaciones
        // ---------------------------------------------

        const fromApprovalService =
            runtime.executionContext ===
            runtime.ContextType.SUITELET;

        const historyChanged = !eq(
            old.getValue({
                fieldId: F.history
            }),
            rec.getValue({
                fieldId: F.history
            })
        );


        const approvalFields = M.RULES.flatMap(
            r =>
                [r.approved].concat(
                    r.first ? [r.first] : []
                )
        ).concat([
            F.level,
            F.next,
            F.reason
        ]);


        const manualApprovalChange =
            approvalFields.some(
                fieldId =>
                    !eq(
                        old.getValue({
                            fieldId: fieldId
                        }),
                        rec.getValue({
                            fieldId: fieldId
                        })
                    )
            );


        if (
            (
                manualApprovalChange ||
                historyChanged
            ) &&
            !(
                fromApprovalService &&
                historyChanged
            )
        ) {

            C.fail(
                'Los campos de autorización FUT ' +
                'solo pueden modificarse mediante ' +
                'los botones Aprobar o Rechazar ' +
                'de la OV.'
            );
        }


        // ---------------------------------------------
        // Validar liberación de la OV
        // ---------------------------------------------

        const oldStatus = String(
            old.getValue({
                fieldId: 'orderstatus'
            }) || ''
        );

        const newStatus = String(
            rec.getValue({
                fieldId: 'orderstatus'
            }) || ''
        );


        if (
            oldStatus === 'A' &&
            newStatus === 'B' &&
            M.checked(rec).length &&
            !(
                fromApprovalService &&
                historyChanged &&
                M.allDone(
                    rec,
                    cfg,
                    M.readHistory(rec)
                )
            )
        ) {

            C.fail(
                'No se puede liberar la orden: ' +
                'faltan validaciones del proceso ' +
                'comercial FUT. Apruebe desde ' +
                'la propia orden de venta.'
            );
        }

    }


    // =====================================================
    // 4. FUNCIONES EXPUESTAS
    // =====================================================

    return {
        beforeLoad,
        beforeSubmit
    };

});

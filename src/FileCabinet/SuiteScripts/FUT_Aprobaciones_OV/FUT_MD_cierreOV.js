/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * FUT | Validaciones compartidas para cierre definitivo de OV.
 * NO requiere registro ni despliegue de script.
 *
 * IMPORTANTE: una OV en Pending Approval NO admite cerrar líneas nativamente.
 * Se bloquea operativamente con candado FUT y estado nativo A.
 * En estado B, se cierran las líneas nativas además del candado FUT.
 */
define(['N/search', './FUT_MD_configAprobaciones', './FUT_MD_motorAprobaciones',
        './FUT_MD_notificaciones'],
    (search, C, M, N) => {

    const LOCK = 'custbody_fut_cerrada';
    const val = (rec, fieldId) => rec.getValue({fieldId});
    const isClosed = rec => M.isOn(val(rec, LOCK));

    const blockingTypes = ['ItemShip', 'CustInvc', 'CashSale', 'PurchOrd'];
    const qtyFields = [
        'quantityfulfilled', 'quantitybilled', 'quantityshiprecv',
        'quantitypicked', 'quantitypacked'
    ];

    function assertRelatedTransactionsAbsent(soId) {
        // El filtro captura documentos relacionados incluso cuando aún no
        // se ha contabilizado la cantidad (p.ej. fulfillment en Picked).
        const rows = search.create({
            type: search.Type.TRANSACTION,
            filters: [
                ['createdfrom', 'anyof', String(soId)], 'AND',
                ['type', 'anyof', blockingTypes], 'AND',
                ['mainline', 'is', 'T']
            ],
            columns: ['internalid', 'type', 'tranid']
        }).run().getRange({start: 0, end: 1}) || [];

        if (rows.length) {
            C.fail('No es posible cerrar esta OV porque ya existen movimientos ' +
                'operativos asociados (surtido, facturación o compras vinculadas). ' +
                'Revise las transacciones relacionadas antes de continuar.');
        }
    }

    function assertNoProgressOnLines(rec) {
        const count = rec.getLineCount({sublistId: 'item'});
        if (!count) C.fail('No se puede cerrar una OV sin líneas de artículo.');
        const fields = new Set(rec.getSublistFields({sublistId: 'item'}));
        for (let i = 0; i < count; i++) {
            for (const fieldId of qtyFields) {
                if (!fields.has(fieldId)) continue;
                const raw = rec.getSublistValue({sublistId: 'item', fieldId, line: i});
                const qty = Number(raw || 0);
                if (!Number.isFinite(qty) || qty > 0) {
                    C.fail('No se puede cerrar la OV. La línea ' + (i + 1) +
                        ' ya presenta actividad de surtido/facturación o un ' +
                        'valor operativo no válido (' + fieldId + ').');
                }
            }
        }
        return {count, fields};
    }

    function validate(rec, cfg) {
        if (!C.applies(rec, cfg, 'initial') || M.isOn(val(rec, 'custbody_licitacion'))) {
            C.fail('Esta orden no está habilitada para el cierre definitivo desde este botón.');
        }
        if (isClosed(rec)) C.fail('Esta orden ya se encuentra cerrada definitivamente.');
        const status = String(val(rec, 'orderstatus') || '');
        if (status !== 'A' && status !== 'B') {
            C.fail('Esta orden tiene un estado operativo que no permite el ' +
                'cierre definitivo desde esta opción. Revise su estado y las transacciones relacionadas.');
        }
        // No basta revisar sólo las cantidades: bloquea Pick/Pack, facturas y PO.
        assertRelatedTransactionsAbsent(rec.id);
        const {count, fields} = assertNoProgressOnLines(rec);
        if (status === 'B' && !fields.has('isclosed')) {
            C.fail('No está disponible el campo de cierre de líneas en la OV. ' +
                'No se efectuó ningún cambio.');
        }
        return {status, count, nativeLineClose: status === 'B'};
    }


    // La autorización se consulta de forma dinámica en cada solicitud.
    // No se usa el creador de la OV ni un rol general como excepción.
    function etapaAutorizada(rec, cfg) {
        const h = M.readHistory(rec);
        const status = String(val(rec, 'orderstatus') || '');
        if (h.state === 'closed' || isClosed(rec)) return null;

        // Mientras hay autorizaciones pendientes, sólo la etapa vigente
        // puede cerrar. Es la misma etapa que puede Aprobar/Rechazar.
        if (h.state === 'active' && status === 'A') {
            const next = M.nextStage(rec, cfg, h);
            if (!next || next.blocked || !next.rule || !Array.isArray(next.users)) {
                return null;
            }
            return {
                condicion: String(next.rule.code),
                nivel: Number(next.level),
                usuarios: next.users.map(String)
            };
        }

        // Si es un rechazo heredado sin nivel ni ciclo explícitos, no
        // suponer que correspondía a nivel 1: fallar de forma segura.
        if (h.state === 'rejected' && status === 'A') {
            const rechazos = (h.rejections || [])
                .filter(x => Number(x.cycle) === Number(h.cycle))
                .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
            const ultimoRechazo = rechazos[0];
            if (!ultimoRechazo || !ultimoRechazo.condition ||
                ![1, 2].includes(Number(ultimoRechazo.level))) return null;
        }

        // Rechazada: última matriz del rechazo de este ciclo.
        // Aprobada totalmente: última matriz que autorizó este ciclo.
        // Reutilizamos la selección empleada para notificar cierres.
        if ((h.state === 'rejected' && status === 'A') ||
            (h.state === 'approved' && status === 'B')) {
            const ultima = N.ultimaMatriz(rec, cfg, h);
            if (!ultima || !Array.isArray(ultima.destinatarios)) return null;
            return {
                condicion: String(ultima.condicion),
                nivel: Number(ultima.nivel),
                usuarios: ultima.destinatarios.map(String)
            };
        }

        return null;
    }

    function usuarioPuedeCerrar(rec, cfg, usuarioId) {
        const etapa = etapaAutorizada(rec, cfg);
        return !!(etapa && etapa.usuarios.includes(String(usuarioId)));
    }

    function exigirAprobador(rec, cfg, usuarioId) {
        if (!usuarioPuedeCerrar(rec, cfg, usuarioId)) {
            C.fail('No está autorizado para cerrar esta orden. ' +
                'Sólo los integrantes de la matriz de aprobación correspondiente ' +
                'pueden realizar esta acción. Actualice la orden y verifique su asignación.');
        }
    }

    // Debe invocarse únicamente después de validate(), en el mismo registro
    // cargado en modo estándar, y guardarse una sola vez con record.save().
    function apply(rec, assessment) {
        if (assessment.nativeLineClose) {
            for (let i = 0; i < assessment.count; i++) {
                rec.setSublistValue({
                    sublistId: 'item', fieldId: 'isclosed', line: i, value: true
                });
            }
        }
        rec.setValue({fieldId: LOCK, value: true});
    }

    return {LOCK, isClosed, validate, apply, etapaAutorizada, usuarioPuedeCerrar, exigirAprobador};
});

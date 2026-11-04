/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * FUT | Auditoría de eventos del proceso de aprobaciones de OV.
 * Módulo de biblioteca: no crear un registro/despliegue de script.
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {
    const TIPO = 'customrecord_fut_apr_evento';
    const LISTA_EVENTO = 'customlist_fut_apr_evento';
    const LISTA_NOTIF = 'customlist_fut_es_not';
    const cache = {};

    function opcion(lista, nombre) {
        const clave = lista + '|' + nombre;
        if (cache[clave]) return cache[clave];
        const filas = search.create({
            type: lista,
            filters: [
                ['name', 'is', nombre], 'AND',
                ['isinactive', 'is', 'F']
            ],
            columns: ['internalid', 'name']
        }).run().getRange({start: 0, end: 2}) || [];
        if (filas.length !== 1) {
            throw Error('FUT historial: se esperaba una sola opción activa "' +
                nombre + '" en ' + lista + '. Encontradas: ' + filas.length);
        }
        cache[clave] = Number(filas[0].getValue({name: 'internalid'}));
        return cache[clave];
    }

    function poner(rec, fieldId, value) {
        if (value !== null && value !== undefined && value !== '') {
            rec.setValue({fieldId, value});
        }
    }

    function registrar(p) {
        if (!Number.isInteger(Number(p.ordenId)) || Number(p.ordenId) <= 0) {
            throw Error('FUT historial: ID de orden inválido.');
        }
        if (!Number.isInteger(Number(p.usuarioId)) || Number(p.usuarioId) <= 0) {
            throw Error('FUT historial: usuario responsable inválido.');
        }
        if (!p.tipo || !p.clave) {
            throw Error('FUT historial: faltan el tipo o la clave única del evento.');
        }
        const rec = record.create({type: TIPO, isDynamic: false});
        // La numeración automática genera el ID FUT-EVT-xxxxxx.
        // Con 'Include Name' activo, altname identifica el evento en la lista.
        rec.setValue({fieldId: 'altname', value:
            'OV ' + p.ordenId + ' - ' + p.tipo + ' - Ciclo ' + (Number(p.ciclo) || 1) +
            (p.condicion ? ' - Cond. ' + p.condicion : '') +
            (p.nivel ? ' - N' + p.nivel : '')});
        // Clave estable por transición. El ID externo evita duplicados por reintentos.
        rec.setValue({fieldId: 'externalid', value: String(p.clave)});
        poner(rec, 'custrecord_fut_evt_ov', Number(p.ordenId));
        poner(rec, 'custrecord_fut_evt_tipo', opcion(LISTA_EVENTO, p.tipo));
        poner(rec, 'custrecord_fut_evt_usuario', Number(p.usuarioId));
        poner(rec, 'custrecord_fut_evt_ciclo', Number(p.ciclo) || 1);
        if (p.condicion) {
            poner(rec, 'custrecord_fut_evt_condicion', Number(p.condicion));
        }
        if (p.nivel) {
            poner(rec, 'custrecord_fut_evt_nivel', Number(p.nivel));
        }
        if (p.motivoId) {
            poner(rec, 'custrecord_fut_evt_motivo', Number(p.motivoId));
        }
        poner(rec, 'custrecord_fut_evt_detalle',
            typeof p.detalle === 'string' ? p.detalle : JSON.stringify(p.detalle || {}));
        poner(rec, 'custrecord_fut_evt_estado_ant', p.estadoAnterior);
        poner(rec, 'custrecord_fut_evt_estado_nvo', p.estadoNuevo);
        poner(rec, 'custrecord_fut_evt_origen', p.origen || 'FUT');
        // Cada evento captura los destinatarios de las matrices vigentes.
        // La cola programada enviará sólo a estos destinatarios, aunque las
        // matrices cambien después de registrar la operación.
        const envios = Array.isArray(p.envios) ? p.envios.filter(x =>
            x && Array.isArray(x.destinatarios) && x.destinatarios.length) : [];
        if (envios.length || p.errorNotificacion) {
            poner(rec, 'custrecord_fut_evt_dest', JSON.stringify({
                version: 1, envios, creado: new Date().toISOString(),
                ultimoError: String(p.errorNotificacion || '')
            }));
        }
        const estadoNotificacion = envios.length ? 'PENDIENTE' :
            (p.errorNotificacion ? 'ERROR' : 'NO APLICA');
        poner(rec, 'custrecord_fut_evt_notif', opcion(LISTA_NOTIF,
            estadoNotificacion));
        const id = rec.save({enableSourcing: false, ignoreMandatoryFields: false});
        log.audit({title: 'FUT HISTORIAL REGISTRADO',
            details: JSON.stringify({id, ordenId: p.ordenId, tipo: p.tipo,
                ciclo: p.ciclo, clave: p.clave})});
        return id;
    }

    // El registro se realiza DESPUÉS de guardar la OV. Una falla del historial
    // no debe inducir a repetir una aprobación que sí quedó guardada.
    function registrarSeguro(p) {
        try {
            return {ok: true, id: registrar(p)};
        } catch (e) {
            log.error({title: 'FUT HISTORIAL PENDIENTE',
                details: JSON.stringify({ordenId: p.ordenId, tipo: p.tipo,
                    clave: p.clave, error: e.name || 'Error', mensaje: e.message})});
            return {ok: false, mensaje: String(e.message || e)};
        }
    }

    return {registrar, registrarSeguro, opcionEstado: nombre => opcion(LISTA_NOTIF, nombre)};
});

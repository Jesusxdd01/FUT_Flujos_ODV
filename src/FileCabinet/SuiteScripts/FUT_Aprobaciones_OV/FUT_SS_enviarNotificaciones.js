/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * FUT | Enviar notificaciones de aprobaciones OV.
 * Usar DOS despliegues de este mismo script:
 *  - customdeploy_fut_ss_envio_notif    -> Not Scheduled, disparo por N/task
 *  - customdeploy_fut_ss_notif_respaldo -> Scheduled, cada 15 minutos
 * No se requiere modificar el código según el despliegue ejecutado.
 */
define(['N/log', 'N/runtime', './FUT_MD_notificaciones'],
    (log, runtime, N) => {
        function execute() {
            log.audit({title: 'Procesador de correos iniciado',
                details: JSON.stringify({
                    deploymentId: runtime.getCurrentScript().deploymentId
                })});
            const resultado = N.procesarCola();
            log.audit({title: 'Procesador de correos finalizado',
                details: JSON.stringify(resultado)});
        }
        return {execute};
    });

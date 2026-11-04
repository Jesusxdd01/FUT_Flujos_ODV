/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * FUT | Solicita de manera asíncrona el procesamiento de correos.
 * Biblioteca compartida, sin registro ni despliegue propio.
 */
define(['N/task', 'N/log'], (task, log) => {
    const SCRIPT_ID = 'customscript_fut_ss_envio_notif';
    // SOLO el despliegue a demanda se invoca por N/task.
    // El despliegue de respaldo Scheduled se configura en la UI.
    const DEPLOYMENT_ID = 'customdeploy_fut_ss_envio_notif';

    function solicitar(origen) {
        try {
            const tarea = task.create({
                taskType: task.TaskType.SCHEDULED_SCRIPT,
                scriptId: SCRIPT_ID,
                deploymentId: DEPLOYMENT_ID
            });
            const taskId = tarea.submit();
            if (!taskId) {
                throw Error('NetSuite no devolvió identificador de ejecución.');
            }
            log.audit({title: 'Envío de correos solicitado',
                details: JSON.stringify({origen: String(origen || ''), taskId})});
            return {solicitado: true, taskId};
        } catch (e) {
            // Si hay una ejecución activa, o faltan permisos de programación,
            // el evento permanece PENDIENTE para el despliegue de respaldo.
            log.audit({title: 'Correos en cola para recuperación',
                details: JSON.stringify({origen: String(origen || ''),
                    motivo: String(e.message || e)})});
            return {solicitado: false, mensaje: String(e.message || e)};
        }
    }

    return {solicitar};
});

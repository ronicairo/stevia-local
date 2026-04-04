window.addEventListener('DOMContentLoaded', function () {
    const type = document.getElementById('type').value;
    const table = $('#suivi-workflow-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('workflow_suivi_get_data', {type: type}),
            data: function (d) {
                d.filters = {'filters': getFilters('suivi-workflow-dataTable')}
                return d;
            }
        },
        columns: [
            {
                "data": "numeroReference",
                "name": "numero_reference",
                "render": function (data, type, row) {
                    const url = Routing.generate('creance_from_echeance', {
                        'id': row.numeroReference,
                    })

                    return `<a href="${url}" title="Consulter">${row.numeroReference}</a>`
                }
            },
            {
                "data": "numeroDebiteur",
                "name": "numero_debiteur",
                "className": "clickable-debiteur"
            },
            {
                "data": "workflow",
                "name": "description"
            },
            {
                "data": "derniereetapeexecutee",
                "name": "derniereetapeexecutee"
            },
            {
                "data": "executeele",
                "name": "executeele"
            },
            {
                "data": "stopped",
                "name": "dpede",
                "render": function (data, type, row) {
                    const isStopped = row.stopped === 0;
                    const colorClass = isStopped ? 'bg-success' : 'bg-danger';
                    const title = isStopped ? 'En cours' : 'En pause';

                    return `<div class="d-flex justify-content-center align-items-center" style="height: 100%;">
                    <span class="rounded-circle ${colorClass}" title="${title}" style="width: 15px; height: 15px; display: inline-block;"></span>
                </div>`;
                }
            },
            {
                "data": "etapeavenir",
                "name": "etapeavenir"
            },
            {
                "data": "planifieele",
                "name": "planifieele"
            },
            {
                "data": "reporteeau",
                "name": "reporteeau"
            },
            {
                "name": "reporter",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('workflow_suivi_report', {creanceRegroupeeId: row.id});

                    return `<div class="d-flex justify-content-center align-items-center">
                                <a href="${url}" title="Reporter l'exécution">
                                    <i class="fs-3 bi bi-clock-history"></i>
                                </a>
                            </div>`;
                }

            },
            {
                "name": "etape_precedente",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('creance_regroupee_retour_etape_wf', {id: row.id, etat: 1});

                    if (row.derniereetapeexecutee == null) return "";

                    return `<div class="icon_back_wf text-center text-primary cursor-pointer" 
                                    data-href="${url}" 
                                    title="Retourner à l'étape précédente"
                                    data-message="Confirmez-vous le retour à l'étape précedente ?"
                                    >
                                    <i class="fs-3 bi bi-arrow-return-left"></i>
                             </div>`;
                }
            },
            {
                "name": "reinitialiser",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('creance_regroupee_retour_etape_wf', {id: row.id, etat: 0});

                    return `<div class="icon_back_wf text-center text-danger cursor-pointer" 
                                    data-href="${url}" 
                                    title="Retourner au début du workflow avec suppression historique"
                                    data-message="Confirmez-vous la réinitialisation de cette créance ? Cette action supprimera l'historique de la créance"
                                    >
                                    <i class="fs-3 bi bi-bootstrap-reboot"></i>
                             </div>`;
                }
            },
            {
                "name": "retour_debut_wf",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('creance_regroupee_reset_etape_wf_history', {id: row.id});

                    return `<div class="icon_back_wf text-center text-primary cursor-pointer" 
                                    data-href="${url}" 
                                    title="Retourner au début du workflow en conservant historique"
                                    data-message="Confirmez-vous le retour au début du workflow tout en conservant l'historique ? "
                                    >
                                    <i class="fs-3 bi bi-arrow-bar-left"></i>
                             </div>`;
                }
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('workflow_suivi_export', {type: type}),
                        data: JSON.stringify(
                            {filters: getFilters('suivi-workflow-dataTable')}
                        ),
                        method: "POST",
                        success: (response) => {
                            const BOM = new Uint8Array([0xEF,0xBB,0xBF]);
                            const link = document.createElement('a');
                            link.href = window.URL.createObjectURL(
                                new Blob(
                                    [BOM, response],
                                    {type: 'text/csv'}
                                )
                            );
                            link.download = 'suivi_workflow.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function (request, status, error) {
                            console.error('Une erreur s\'est produite lors du chargement :', status, error);
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.');
                        }
                    });
                }
            }
        ],
        initComplete: function () {
            const processingDiv = $('.dt-processing');
            $('#custom-container').append(processingDiv);
        }
    })

    table.on('draw.dt', function () {
        const settings = table.settings()[0]
        // Bouton input checkbox pour cocher/decrocher les checkonx du tableau
        const btnsWF = settings.nTable.querySelectorAll('.icon_back_wf');

        btnsWF.forEach((btn) => {
            btn.addEventListener('click', (event) => {
                event.preventDefault()

                confirm(btn.dataset.message)
                    .then(response => {
                        if(response) window.location.href = btn.dataset.href
                    })
            })
        })
    });

    initializeClickableDebiteur(table)
    initializeFilters(table)
    initializeButtons(table)
    rememberDataTable(table)
})
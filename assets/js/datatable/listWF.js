window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-wf-dataTable').DataTable({
        ajax: {
            url: Routing.generate('listWfAll'),
            data: function (d) {
                d.filters = getFilters('list-wf-dataTable')
                return d;
            }
        },
        order: [[3, 'desc']],
        pageLength: 10,
        lengthMenu: [10, 25, 50],
        columns: [
            {
                "data": "id",
                "name": "l.id"
            },
            {
                "data": "condition",
                "name": "l.condition",
                "render": () => {
                    return "<span>Chargement...</span>"
                },
                // Afficher les wf avec anomalies
                createdCell: function (td, cellData, rowData) {
                    $.ajax({
                        url: Routing.generate('checkCondition', {id: rowData.id}),
                        method: 'POST',
                        success: function (response) {
                            if (typeof response.condition !== 'undefined' && response.condition === false) {
                                $(td).addClass('bg-danger text-white')
                                return $(td).html(`<div class="d-flex align-items-center gap-2 fw-bold" title='La synthaxe est invalide'><i class="bi bi-exclamation-triangle fs-5"></i> ${cellData}</div>`)
                            } else if (response.message === 'Workflow sans étape') {
                                $(td).addClass('bg-danger text-white');
                                return $(td).html(`<div class="d-flex align-items-center gap-2 fw-bold" title='Aucune étape dans le workflow'><i class="bi bi-exclamation-triangle fs-5"></i> ${cellData}</div>`)
                            } else if (typeof response.message !== 'undefined') {
                                $(td).addClass('bg-warning')
                                return $(td).html(`<div class="d-flex align-items-center gap-2 fw-semibold" title='${response.message}'><i class="bi bi-exclamation-triangle fs-5"></i> ${cellData}</div>`)
                            } else {
                                return $(td).html(cellData)
                            }
                        },
                        error: function () {
                            $(td).html('Erreur');
                        }
                    });
                }
            },
            {
                "data": "description",
                "name": "l.description"
            },
            {
                "data": "priorite",
                "name": "l.priorite",
                "render": function (row) {
                    // permet d'afficher le nombre avec l'espace ex: 7 000 pour 7000
                    return row.toLocaleString()
                }
            },
            {
                "name": "show",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('etape_wf', {'workflowId': row.id})
                    return `<div class="text-center"><a href="${url}" title="Etapes Workflow"><i class='fs-3 bi bi-eye'></i></a></div>`
                }
            },
            {
                "name": "update",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('listeWF_edit', {'id': row.id})
                    return `<div class="text-center"><a href="${url}" title="Modifier"><i class='fs-3 bi bi-pencil-square'></i></a></div>`
                }
            },
            {
                "name": "export",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('export', {'id': row.id})
                    return `<div class="text-center"><a href="${url}" title="Exporter"><i class='fs-3 bi bi-cloud-download'></i></a></div>`
                }
            },
            {
                "name": "suspend",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('suspendWF', {'id': row.id})
                    return `<div class="text-center"><a href="${url}" title="Suspendre"><i class='fs-3 bi bi-sign-stop-fill text-danger'></i></a></div>`
                }
            }
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing');
            $('#custom-container').append(processingDiv);
        },

    })

    initializeFilters(table)
    initializeButtons(table)
})
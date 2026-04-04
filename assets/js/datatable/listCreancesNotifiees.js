window.addEventListener('DOMContentLoaded', function () {
    const JsVars = $("#js-vars").data('vars');

    const table = $('#list-creances-notifiees').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('supervision_liste_creance_notifiees_get_data'),
            data: function (d) {
                d.filters = getFilters('list-creances-notifiees')
                return d;
            }
        },
        columns: [
            {
                "data": "numeroReference",
                "name": "numeroReference",
                "render": function (data, type, row) {
                    // Redirige vers le détail de la créance de référence.
                    if (JsVars.privilege === 'recouv') return `<a href="${Routing.generate('creance_edit', { id: row.idCreance })}">${data}</a>`;
                    return `<a href="${Routing.generate('creance_parcours_show', { id: row.idCreance })}">${data}</a>`;
                }
            },
            {
                "data": "numeroCreance",
                "name": "numeroCreance"
            },
            {
                "data": "numeroDebiteur",
                "name": "numeroDebiteur"
            },
            {
                "data": "montantInitial",
                "name": "montantInitial",
                className: 'dt-body-right'
            },
            {
                "data": "solde",
                "name": "solde",
                className: 'dt-body-right'
            },
            {
                "data": "numUgeDetect",
                "name": "numUgeDetect"
            },
            {
                "data": "dateCourrier",
                "name": "dateCourrier"
            },
            {
                "data": "auteur",
                "name": "auteur"
            },
            {
                "data": "natureCompte",
                "name": "natureCompte"
            },
            {
                "data": "catDebiteur",
                "name": "catDebiteur"
            },
            {
                "data": "dateDetect",
                "name": "dateDetect"
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('supervision_liste_creance_notifiees_export'),
                        data: JSON.stringify({
                                filters: getFilters('list-creances-notifiees')
                            }
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
                            link.download = 'creances_notifiees.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function () {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            $('#list-creances-notifiees').DataTable().processing(false);
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.');
                        },
                    });
                }
            }
        ]
    })

    initializeFilters(table)
    initializeButtons(table)
    rememberDataTable(table)

    const footers = {
        totalMontantInitial: $('#list-creances-notifiees_wrapper .dt-scroll-foot tfoot tr th:eq(3)'),
        totalSolde: $('#list-creances-notifiees_wrapper .dt-scroll-foot tfoot tr th:eq(4)')
    }
    const route = Routing.generate('supervision_liste_creance_notifiees_get_soldes')

    initializeSoldes(table, footers, route)
})
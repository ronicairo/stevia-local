window.addEventListener('DOMContentLoaded', function () {
    const table = $('#creance-sans-mouv-sup80-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('supervision_creance_sans_mouv_sup80_liste_get_data'),
            data: function (d) {
                d.filters = getFilters('creance-sans-mouv-sup80-dataTable')
                return d;
            }
        },
        order: [[2, 'asc']],
        columns: [
            {
                "data": "numCompte",
                "name": "numCompte"
            },
            {
                "data": "numUgeDetect",
                "name": "numUgeDetect"
            },
            {
                "data": "numeroReference",
                "name": "numeroReference",
                "render": function (data) {
                    const url = Routing.generate('creance_reference', {id: data});
                    return `<a href="${url}">${data}</a>`
                }
            },
            {
                "data": "numeroCreance",
                "name": "numeroCreance"
            },
            {
                "data": "numeroDebiteur",
                "name": "numeroDebiteur",
                "className": "clickable-debiteur"
            },
            {
                "data": "catDebiteur",
                "name": "catDebiteur"
            },
            {
                "data": "natureCompte",
                "name": "natureCompte"
            },
            {
                "data": "dateDetect",
                "name": "dateDetect"
            },
            {
                "data": "montantInitial",
                "name": "montantInitial",
                className: 'dt-body-right'
            },
            {
                "data": "partMutuel",
                "name": "partMutuel",
                className: 'dt-body-right'
            },
            {
                "data": "solde",
                "name": "solde",
                className: 'dt-body-right'
            },
            {
                "data": "dateDerOpe",
                "name": "dateDerOpe"
            },
            {
                "data": "typeOperation",
                "name": "typeOperation"
            },
            {
                "data": "notification",
                "name": "notification"
            },
            {
                "data": "relance",
                "name": "relance"
            },
            {
                "data": "misedemeure",
                "name": "misedemeure"
            },
            {
                "data": "contrainte",
                "name": "contrainte"
            },
            {
                "data": "biennale",
                "name": "biennale"
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('supervision_creance_sans_mouv_sup80_liste_export'),
                        data: JSON.stringify(
                            {
                                filters: getFilters('creance-sans-mouv-sup80-dataTable'),
                            }
                        ),
                        method: "POST",
                        success: (response) => {
                            // Si la réponse commence par le premier header attendu, on crée la fenêtre de chargement
                            if (response.startsWith('Numero reference')) {
                                const link = document.createElement('a');
                                const BOM = new Uint8Array([0xEF, 0xBB, 0xBF]);
                                link.href = window.URL.createObjectURL(
                                    new Blob(
                                        [BOM, response],
                                        {type: 'text/csv'}
                                    )
                                );
                                link.download = 'creances_sans_mouv_sup80.csv';
                                link.click();
                                window.URL.revokeObjectURL(link);

                                this.processing(false);
                            } else {
                                alert('Une erreur est survenue lors de la génération du CSV. Veuillez réessayer.');
                                this.processing(false);
                            }
                        },
                        error: (request, status, error) => {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            console.error('Une erreur s\'est produite lors du chargement :', status, error);
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.');
                            this.processing(false);
                        }
                    });
                }
            }
        ],
    });

    initializeClickableDebiteur(table)
    initializeFilters(table);
    initializeButtons(table)
    rememberDataTable(table)

    const footers = {
        totalMontantInitial: $('#creance-sans-mouv-sup80-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(8)'),
        totalPartMutuelle: $('#creance-sans-mouv-sup80-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(9)'),
        totalSolde: $('#creance-sans-mouv-sup80-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(10)')
    }
    const route = Routing.generate('supervision_creances_liste_soldes_sup80')

    initializeSoldes(table, footers, route)
});
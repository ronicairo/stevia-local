window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-suivi-compte').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: Routing.generate('supervision_suivi_par_comptes_get_data'),
        ajax: {
            url: Routing.generate('supervision_suivi_par_comptes_get_data'),
            data: function (d) {
                d.filters = getFilters('list-suivi-compte')
                return d;
            }
        },
        columns: [
            {
                "data": "numeroReference",
                "name": "cr.numeroReference"
            },
            {
                "data": "numeroCreance",
                "name": "c.numeroCreance"
            },
            {
                "data": "numeroDebiteur",
                "name": "cr.numeroDebiteur",
                "className": "clickable-debiteur"
            },
            {
                "data": "catDebiteur",
                "name": "c.catDebiteur"
            },
            {
                "data": "dateDetection",
                "name": "dateDetection"
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
                "data": "natureCompte",
                "name": "natureCompte"
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('supervision_suivi_par_comptes_export'),
                        data: JSON.stringify({
                                filters: getFilters('list-suivi-compte')
                            }
                        ),
                        method: "POST",
                        success: (response) => {
                            const link = document.createElement('a');
                            const BOM = new Uint8Array([0xEF,0xBB,0xBF]);
                            link.href = window.URL.createObjectURL(
                                new Blob(
                                    [BOM, response],
                                    {type: 'text/csv'}
                                )
                            );
                            link.download = 'suivi_par_compte.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function () {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            $('#list-suivi-compte').DataTable().processing(false);
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.');
                        },
                    });
                }
            }
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing')
            $('#custom-container').append(processingDiv)
        },

    })

    initializeClickableDebiteur(table, 'cr\\.numeroDebiteur')
    initializeFilters(table)
    initializeButtons(table)

    const footers = {
        totalMontantInitial: $('#list-suivi-compte_wrapper .dt-scroll-foot tfoot tr th:eq(5)'),
        totalPartMutuel: $('#list-suivi-compte_wrapper .dt-scroll-foot tfoot tr th:eq(6)'),
        totalSolde: $('#list-suivi-compte_wrapper .dt-scroll-foot tfoot tr th:eq(7)')
    }
    const route = Routing.generate('supervision_suivi_par_comptes_get_soldes')

    initializeSoldes(table, footers, route)
})
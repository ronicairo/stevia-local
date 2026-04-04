window.addEventListener('DOMContentLoaded', function () {

    const table = $('#creances_suspendues_pour_motif_anv-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('creances_suspendues_motif_anv_list'),
            type: 'POST',
            data: function (d) {
                d.filters = {'filters': getFilters('suivi-echeance-dataTable')}
                return d;
            }
        },
        order: [[1, 'desc']],
        columns: [
            {
                "data": "catDebiteur",
                "name": "catDebiteur"
            },
            {
                "data": "numeroCreance",
                "name": "numeroCreance"
            },
            {
                "data": "natureCompte",
                "name": "natureCompte"
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
                "data": "motifAnv",
                "name": "motifAnv"
            },
            {
                "data": "dateProposition",
                "name": "dateProposition"
            },
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    // Récupère les filtres actifs dans le localStorage.
                    const filters = getFilters('creances_suspendues_pour_motif_anv-dataTable');

                    $.ajax({
                        url: Routing.generate('creance_suspendus_pole_motif_export', {type: 'anv'}),
                        data: JSON.stringify({
                            filters: filters
                        }),
                        method: "POST",
                        success: (response) => {
                            // Si la réponse commence par le premier header attendu, on crée la fenêtre de chargement
                            if (response.startsWith('numero')) {
                                const BOM = new Uint8Array([0xEF,0xBB,0xBF]);
                                const link = document.createElement('a');
                                link.href = window.URL.createObjectURL(
                                    new Blob(
                                        [BOM, response],
                                        {type: 'text/csv'}
                                    )
                                );
                                link.download = 'creances_suspendues_motif_ANV.csv';
                                link.click();
                                window.URL.revokeObjectURL(link);

                                this.processing(false);
                            } else {
                                alert('Une erreur est survenue lors de la génération du CSV. Veuillez réessayer.');
                                this.processing(false);
                            }
                        },
                        error: () => {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.');
                            this.processing(false);
                        },
                    });
                }
            }
        ]
    });

    initializeFilters(table)
    initializeButtons(table)

    const footers = {
        totalMontantInitial: $('#creances_suspendues_pour_motif_anv-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(3)'),
        totalSolde: $('#creances_suspendues_pour_motif_anv-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(4)')
    }
    const route = Routing.generate('creance_suspendues_motif_anv_soldes')

    initializeSoldes(table, footers, route)
})
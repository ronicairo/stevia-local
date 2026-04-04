window.addEventListener('DOMContentLoaded', function () {

    const table = $('#creance_suspendus_pole_motif-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('creance_suspendus_pole_motif_liste'),
            data: function (d) {
                d.filters = {'filters': getFilters('creance_suspendus_pole_motif-dataTable')}
                return d;
            }
        },
        order: [[0, 'desc']],
        columns: [
            {
                "data": "numeroReference",
                "name": "numeroReference",
                "render": function (data) {
                    const url = Routing.generate('creance_reference', {id: data});
                    return `<a href="${url}">${data}</a>`;
                }
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
                "data": "montantInitial",
                "name": "montantInitial",
                "className": 'dt-body-right'
            },
            {
                "data": "solde",
                "name": "solde",
                "className": 'dt-body-right'
            },
            {
                "data": "libelleMotif",
                "name": "libelleMotif"
            },
            {
                "data": "motifAnv",
                "name": "motifAnv"
            },
            {
                "data": "dateSuspend",
                "name": "dateSuspend"
            },
            {
                "data": "numUgeDetect",
                "name": "numUgeDetect"
            },
            {
                "data": "npaiSuspend",
                "name": "npaiSuspend"
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    // Récupère les filtres actifs dans le localStorage.
                    const filters = getFilters('creance_suspendus_pole_motif-dataTable');
                    $.ajax({
                        url: Routing.generate('creance_suspendus_pole_motif_export'),
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
                                link.download = 'creances_suspendues.csv';
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

    initializeClickableDebiteur(table)
    initializeFilters(table);
    initializeButtons(table);
    rememberDataTable(table)

    const footers = {
        totalMontantInitial: $('#creance_suspendus_pole_motif-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(4)'),
        totalSolde: $('#creance_suspendus_pole_motif-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(5)')
    }
    const route = Routing.generate('creance_suspendues_motif_soldes');

    initializeSoldes(table, footers, route);
})
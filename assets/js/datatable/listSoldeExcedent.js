window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-solde-excedent-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('solde_excedent_get_data'),
            data: function (d) {
                d.filters = getFilters('list-solde-excedent-dataTable')
                return d;
            }
        },
        columns: [
            {
                "data": "numeroCreance",
                "name": "creance.numeroCreance"
            },
            {
                "data": "numeroDebiteur",
                "name": "creance.numeroDebiteur",
                "className": "clickable-debiteur"
            },
            {
                "data": "catDebiteur",
                "name": "creance.catDebiteur"
            },
            {
                "data": "solde",
                "name": "creance.solde"
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('solde_excedent_export'),
                        data: JSON.stringify({
                            filters: getFilters('list-solde-excedent-dataTable')
                        }),
                        method: "POST",
                        success: (response) => {
                            if (response.startsWith('numero')) {
                                const BOM = new Uint8Array([0xEF,0xBB,0xBF]);
                                const link = document.createElement('a')
                                link.href = window.URL.createObjectURL(
                                    new Blob(
                                        [BOM, response],
                                        {type: 'text/csv'}
                                    )
                                )
                                link.download = 'soldes_en_excedent.csv'
                                link.click()
                                window.URL.revokeObjectURL(link)

                                this.processing(false)
                            } else {
                                alert('Une erreur est survenue lors de la génération du CSV. Veuillez réessayer.')
                                this.processing(false)
                            }
                        },
                        error: (request, status, error) => {
                            console.error('Une erreur s\'est produite lors du chargement :', status, error)
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.')
                            this.processing(false)
                        }
                    })
                }
            }
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing')
            $('#custom-container').append(processingDiv)
        },

    })

    initializeClickableDebiteur(table, 'creance\\.numeroDebiteur')
    initializeFilters(table)
    initializeButtons(table)

    const footers = {
        totalSolde: $('#list-solde-excedent-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(3)')
    }
    const route = Routing.generate('solde_excedent_get_solde')

    initializeSoldes(table, footers, route)
})
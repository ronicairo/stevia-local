window.addEventListener('DOMContentLoaded', function () {
    const from = document.getElementById('from')
    const to = document.getElementById('to')

    const table = $('#list-relances-biennales').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('relance_biennale_get_data'),
            data: function (d) {
                d.minDate = from.value
                d.maxDate = to.value
                d.filters = getFilters('list-relances-biennales')
                return d
            }
        },
        columns: [
            {
                "data": "catDebiteur",
                "name": "catDebiteur"
            },
            {
                "data": "nombre",
                "name": "nombre"
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('relance_biennale_export'),
                        data: JSON.stringify({
                                filters: getFilters('list-relances-biennales'),
                                minDate: from.value,
                                maxDate: to.value,
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
                            link.download = 'biennales_effectuees.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function () {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            $('#list-relances-biennales').DataTable().processing(false);
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

    initializeFilters(table)
    initializeButtons(table)

    from.addEventListener('change', () => {
        if (from.value && to.value) $('#list-relances-biennales').DataTable().draw()
    })

    to.addEventListener('change', () => {
        if (from.value && to.value) $('#list-relances-biennales').DataTable().draw()
    })
})
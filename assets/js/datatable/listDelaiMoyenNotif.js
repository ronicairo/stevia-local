window.addEventListener('DOMContentLoaded', function () {
    const from = document.getElementById('from')
    const to = document.getElementById('to')
    const montant = document.getElementById('montant')

    const btnSearch = document.getElementById('btnSearch')
    const btnRefresh = document.getElementById('btnRefresh')

    const table = $('#list-delai-moyen-notif').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('supervision_delai_moyen_notification_datas'),
            data: d => {
                d.montant = montant.value
                d.minDate = from.value
                d.maxDate = to.value
                d.filters = {filters: getFilters('list-delai-moyen-notif')}
                return d;
            }
        },
        columns: [
            {
                "data": "numUgeDetect",
                "name": "l.numUgeDetect"
            },
            {
                "data": "nbreANotifier",
                "name": "nbreANotifier"
            },
            {
                "data": "notifiees",
                "name": "notifiees"
            },
            {
                "data": "total",
                "name": "total"
            },
            {
                "data": "delaiReformate",
                "name": "delai",
                "render": function (data) {

                    return data !== null ? data : '';
                }
            },
            {
                "data": "pct",
                "name": "pct",
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('supervision_delai_moyen_export'),
                        data: JSON.stringify({
                                filters: getFilters('list-delai-moyen-notif'),
                                minDate: from.value,
                                maxDate: to.value,
                                montant: montant.value,
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
                            link.download = 'delai_moyen_notif.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function () {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            $('#list-delai-moyen-notif').DataTable().processing(false);
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
    const footers = {
        totalNbreANotifier: $('#list-delai-moyen-notif_wrapper .dt-scroll-foot tfoot tr th:eq(1)'),
        totalNotifiees: $('#list-delai-moyen-notif_wrapper .dt-scroll-foot tfoot tr th:eq(2)'),
        totalTotal: $('#list-delai-moyen-notif_wrapper .dt-scroll-foot tfoot tr th:eq(3)')
    }

    btnSearch.addEventListener('click', () => {
        const options = {
            montant: montant.value,
            minDate: from.value,
            maxDate: to.value
        }
        $('#list-delai-moyen-notif').DataTable().draw()
    })

    btnRefresh.addEventListener('click', () => {
        from.value = ''
        to.value = ''
        montant.value = ''
        $('#list-delai-moyen-notif').DataTable().draw()
    })

    const options = {
        montant: montant.value,
        minDate: from.value,
        maxDate: to.value
    }
})
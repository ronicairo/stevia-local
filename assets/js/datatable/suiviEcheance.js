window.addEventListener('DOMContentLoaded', function () {
    const table = $('#suivi-echeance-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('echeance_get_data'),
            data: function (d) {
                d.filters = {'filters': getFilters('suivi-echeance-dataTable')}
                return d;
            }
        },
        order: [[0, 'desc']],
        columns: [
            {
                "data": "numeroReference",
                "name": "numeroReference",
                "render": function (data, type, row) {
                    const url = Routing.generate('creance_from_echeance', {
                        'id': row.numeroReference,
                    })

                    return `<a href="${url}" title="Consulter">${row.numeroReference}</a>`
                }
            },
            {
                "data": "numeroDebiteur",
                "name": "numeroDebiteur",
                "render": function (data, type, row) {
                    let url = Routing.generate('creance_parcours')
                    url += "?numero_debiteur=" + row.numeroDebiteur

                    return `<a href="${url}" title="Consulter" class="link-numero-debiteur" data-numero-debiteur="${data}">${row.numeroDebiteur}</a>`
                }
            },
            {"data": "catDebiteur", "name": "catDebiteur"},
            {"data": "dateEcheance", "name": "dateEcheance"},
            {
                "data": "echeance",
                "name": "echeance",
                "render": function (data, type, row) {
                    return `<div class="text-ellipsis" title="${row.echeance}">${row.echeance}</div>`
                }
            },
            {"data": "montantInitial", "name": "montantInitial", "className": "text-end"},
            {"data": "solde", "name": "solde", "className": "text-end"},
            {"data": "uge", "name": "uge"},
            {"data": "numUgeGestion", "name": "numUgeGestion"},
            {"data": "nature", "name": "nature"}
        ],

        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('echeance_suivi_export'),
                        data: JSON.stringify(
                            {filters: getFilters('suivi-echeance-dataTable')}
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
                            link.download = 'echeances_suivi.csv';
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
        initComplete: function (settings) {

            // list-creance-dataTable
            const linksNumeroDeb = settings.nTable.querySelectorAll('.link-numero-debiteur');

            linksNumeroDeb.forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();

                    filters['list-creance-dataTable'] = {}

                    filters['list-creance-dataTable']['numeroDebiteur'] = {
                        'value': link.dataset.numeroDebiteur,
                        'operator': 'contains',
                        'type': 'numdeb'
                    }

                    localStorage.setItem('filters', JSON.stringify(filters))

                    window.location.href = link.href
                })
            })
        }
    })

    initializeFilters(table)
    initializeButtons(table)
    rememberDataTable(table)
})
window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-adresses-debiteurs').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('adresses_externes_debiteurs_liste'),
            data: function (d) {
                d.filters = getFilters('list-adresses-debiteurs')
                return d;
            }
        },
        autoWidth: true,
        columns: [
            {
                "data": "numeroDebiteur",
                "name": "numeroDebiteur",
                "render": function (data) {
                    return `<div class="text-center">
                                <a href="${Routing.generate('creance_parcours') + '?numero_debiteur=' + data}" 
                                data-numero-debiteur="${data}" class="btn-view-numero-debiteur">${data}</a>
                            </div>`
                }
            },
            {
                "data": "civilite",
                "name": "civilite"
            },
            {
                "data": "identite",
                "name": "identite"
            },
            {
                "data": "adresse",
                "name": "adresse",
                "width": "25em",
                "orderable": false,
            },
            {
                "data": "cptLibelleVoie",
                "name": "cptLibelleVoie"
            },
            {
                "data": "codePostal",
                "name": "codePostal"
            },
            {
                "data": "commune",
                "name": "commune",
            },
            {
                "data": "dateMaj",
                "name": "dateMaj"
            },
            {
                "name": "update",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('adresse_debiteur_edit', {
                        id: row.id,
                        creanceId: row.creanceId
                    });
                    return `<div class="text-center"><a href="${url}" title="Modifier"><i class='fs-3 bi bi-pencil-square'></i></a></div>`;
                }
            },
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('adresse_debiteur_export'),
                        data: JSON.stringify({
                                filters: getFilters('list-adresses-debiteurs')
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
                            link.download = 'adresses-debiteurs.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function () {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            $('#list-adresses-debiteurs').DataTable().processing(false);
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.');
                        },
                    });
                }
            }
        ],
        initComplete: function (settings) {
            const btnViewNumeroDebiteur = settings.nTable.querySelectorAll('.btn-view-numero-debiteur');

            btnViewNumeroDebiteur.forEach(btn => {
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    const numDeb = btn.getAttribute('data-numero-debiteur')

                    filters['list-creance-dataTable'] = {}

                    filters['list-creance-dataTable']['numeroDebiteur'] = {
                        'value': numDeb,
                        'operator': 'contains',
                        'type': 'numdeb'
                    }

                    localStorage.setItem('filters', JSON.stringify(filters))

                    window.location.href = btn.href
                })
            })
        }
    })

    initializeFilters(table)
    initializeButtons(table)
})
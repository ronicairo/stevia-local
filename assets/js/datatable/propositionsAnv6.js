window.addEventListener('DOMContentLoaded', function () {
    const table = $('#prop-anv-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('supervision_propositions_anv6_liste'),
            data: function (d) {
                d.filters = getFilters('prop-anv-dataTable')
                return d
            }
        },
        columns: [
            {
                // colonne pour plier et deplier le subtable
                "data": null,
                "name": "child",
                "className": 'dt-control',
                "orderable": false,
                "defaultContent": '',
                "searchable": false
            },
            {"data": "numCompte", "name": "numCompte"},
            {"data": "natureCpt", "name": "natureCpt"},
            {"data": "numeroReference", "name": "numeroReference"},
            {"data": "numeroCreance", "name": "numeroCreance"},
            {"data": "montantInitial", "name": "montantInitial", "className": "text-end"},
            {"data": "partMutuel", "name": "partMutuel", "className": "text-end"},
            {"data": "solde", "name": "solde", "className": "text-end"},
            {"data": "dateCourrierMed", "name": "dateCourrierMed", "className": "text-start"},
            {"data": "natureDerOpe", "name": "natureDerOpe"},
            {"data": "numUgeDetect", "name": "numUgeDetect"},
            {
                "data": "datemed",
                "searchable": false,
                "render": (data, type, row) => {
                    return row.dateCourrierMed
                },
                "orderable": false
            },
            {"data": "catDebiteur", "name": "catDebiteur"},
            {
                "data": "numeroDebiteur",
                "name": "numeroDebiteur",
                "className": "clickable-debiteur"
            },
            {"data": "sommeDeb", "name": "sommeDeb", "className": "text-end"},

        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                charset: 'utf-8',
                bom: true,
                action: function () {
                    $.ajax({
                        url: Routing.generate('pilotage_statistique_proposition_anv_6_export'),
                        data: JSON.stringify(
                            {filters: getFilters('prop-anv-dataTable')}
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
                            link.download = 'Propositions_ANV6.csv';
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
    });

    collapseSubTable(table, "supervision_propositions_anv6_subliste", "numeroCreance")

    initializeClickableDebiteur(table)
    initializeFilters(table);
    initializeButtons(table)

    const footers = {
        totalMontantInitial: $('#prop-anv-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(5)'),
        totalPartMutuelle: $('#prop-anv-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(6)'),
        totalSolde: $('#prop-anv-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(7)')
    }
    const route = Routing.generate('supervision_propositions_anv6_soldes')

    initializeSoldes(table, footers, route)
});
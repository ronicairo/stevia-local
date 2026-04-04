window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-creances-sans-wf-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('creance_sans_workflow_get_data'),
            data: function (data) {
                data.filters = {'filters': getFilters('list-creances-sans-wf-dataTable')};
                data.columns.forEach((column) => {
                    const filterKey = column.data;
                    const operatorSelect = document.querySelector(`#filter-${filterKey}_operator`);
                    const inputValue = document.querySelector(`#filter-${filterKey}`);

                    if (operatorSelect && inputValue) {
                        column.search.value = inputValue.value;
                        column.search.operator = operatorSelect.value;
                    }
                });
                data.filters = getFilters('list-creances-sans-wf-dataTable')
            }
        },
        order: [[0, 'desc']],
        columns: [
            {
                "data": "numeroCreance",
                "name": "c.numeroCreance"
            },
            {
                "data": "numeroDebiteur",
                "name": "c.numeroDebiteur",
                "className": "clickable-debiteur"
            },
            {
                "data": "natureCompte",
                "name": "c.natureCompte"
            },
            {
                "data": "numUgeDetect",
                "name": "c.numUgeDetect"
            },
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    // Récupère les filtres actifs dans le localStorage.
                    $.ajax({
                        url: Routing.generate('creances_sans_workflow_export'),
                        data: JSON.stringify(
                            {filters: getFilters('list-creances-sans-wf-dataTable')}
                        ),
                        method: "POST",
                        success: (response) => {
                            const BOM = new Uint8Array([0xEF, 0xBB, 0xBF]);
                            const link = document.createElement('a');
                            link.href = window.URL.createObjectURL(
                                new Blob(
                                    [BOM, response],
                                    {type: 'text/csv'}
                                )
                            );
                            link.download = 'creances_sans_workflow.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);

                        },
                        error: (request, status, error) => {
                            console.error('Une erreur s\'est produite lors du chargement :', status, error);
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.');
                            this.processing(false);
                        }
                    });
                }
            }
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing')
            $('#custom-container').append(processingDiv)
        }
    })

    initializeClickableDebiteur(table, 'c\\.numeroDebiteur')
    initializeFilters(table)
    initializeButtons(table)
})
window.addEventListener('DOMContentLoaded', () => {

    const table = $('#dossier-revision-smv-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('supervision_revision_dossier_sans_mvts_liste'),
            data: function (data) {
                data.filters = getFilters('dossier-revision-smv-dataTable');
            }
        },
        columns: [
            {
                "data": "numeroReference",
                "name": "numeroReference"
            },
            {
                "data": "numeroDebiteur",
                "name": "numeroDebiteur",
                "className": "clickable-debiteur"
            },
            {
                "data": "catDebiteur",
                "name": "numeroDebiteur"
            },
            {
                "data": "natureCompte",
                "name": "natureCompte"
            },
            {
                "data": "dateDetect",
                "name": "dateDetect"
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
                "data": "dateDerOpe",
                "name": "dateDerOpe"
            },
            {
                "data": "typeOperation",
                "name": "typeOperation"
            },
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('supervision_revision_dossier_sans_mvts_export'),
                        data: JSON.stringify(
                            {filters: getFilters('dossier-revision-smv-dataTable')}
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
                            link.download = 'Révision sans mouvement.csv';
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
    })

    initializeClickableDebiteur(table)
    initializeFilters(table)
    initializeButtons(table)
})
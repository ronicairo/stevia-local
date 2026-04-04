window.addEventListener('DOMContentLoaded', () => {
    const table = $('#dossier-revision-mise-demeure-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('supervision_revision_dossier_med_liste'),
            data: function (d) {
                d.filters = getFilters('dossier-revision-mise-demeure-dataTable')
                return d
            }
        },
        columns: [
            {
                "data": "numeroReference",
                "name": "cr.numeroReference"
            },
            {
                "data": "numeroDebiteur",
                "name": "cr.numeroDebiteur",
                "className": "clickable-debiteur"
            },
            {
                "data": "catDebiteur",
                "name": "c.catDebiteur"
            },
            {
                "data": "natureCompte",
                "name": "c.natureCompte"
            },
            {
                "data": "dateDetect",
                "name": "c.dateDetect"
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
            {
                "data": "dateCourrier",
                "name": "dateCourrier"
            },
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('supervision_revision_dossier_med_export'),
                        data: JSON.stringify(
                            {filters: getFilters('dossier-revision-mise-demeure-dataTable')}
                        ),
                        method: "POST",
                        success: (response) => {
                            const BOM = new Uint8Array([0xEF,0xBB,0xBF]);
                            const link = document.createElement('a')
                            link.href = window.URL.createObjectURL(
                                new Blob(
                                    [BOM, response],
                                    {type: 'text/csv'}
                                )
                            )
                            link.download = 'revision_dossier_avec_mise_demeure_6_mois.csv'
                            link.click()
                            window.URL.revokeObjectURL(link)

                            this.processing(false)
                        },
                        error: function (request, status, error) {
                            console.error('Une erreur s\'est produite lors du chargement :', status, error)
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.')
                        }
                    })
                }
            }
        ],
    })

    initializeClickableDebiteur(table, 'cr\\.numeroDebiteur')
    initializeFilters(table)
    initializeButtons(table)
})
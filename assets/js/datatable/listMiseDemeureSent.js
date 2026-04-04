window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-mise-demeure-sent').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('mise_en_demeure_get_data'),
            data: function (d) {
                d.filters = getFilters('list-mise-demeure-sent')
                return d;
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
                "data": "montantInitial",
                "name": "montantInitial",
                className: 'dt-body-right'
            },
            {
                "data": "solde",
                "name": "solde",
                className: 'dt-body-right'
            },
            {
                "data": "dateCourrier",
                "name": "dateCourrier"
            },
            {
                "data": "natureCompte",
                "name": "natureCompte"
            },
            {
                "data": "catDebiteur",
                "name": "catDebiteur"
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('supervision_mise_en_demeure_liste_export'),
                        data: JSON.stringify({
                                filters: getFilters('list-mise-demeure-sent')
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
                            link.download = 'liste_mise_demeure_envoyees.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function () {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            $('#list-mise-demeure-sent').DataTable().processing(false);
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

    initializeClickableDebiteur(table)
    initializeFilters(table)
    initializeButtons(table)
})
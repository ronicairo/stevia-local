window.addEventListener('DOMContentLoaded', function () {
    const dgpmUrl = document.getElementById('ads_dgpm_url').value
    const table = $('#list-suivi-auto-dataTable').DataTable({
        ajax: {
            url: Routing.generate('log_get_data'),
            data: function (d) {
                d.filters = getFilters('list-suivi-auto-dataTable')
                return d;
            }
        },
        pageLength: 25,
        order: [[0, 'desc']],
        columns: [
            {
                "data": "dateTraitement",
                "name": "dateTraitement"
            },
            {
                "data": "timeOfDate",
                "name": "timeOfDate",
                "orderable": false
            },
            {
                "data": "nomController",
                "name": "nomController"
            },
            {
                "data": "numUgeDetect",
                "name": "numUgeDetect"
            },
            {
                "data": "typeMessage",
                "name": 'typeMessage'
            },
            {
                "data": "message",
                "name": "message",
                "orderable": false
            },
            {
                "data": null,
                "defaultContent": '',
                "name": "anomalie",
                "orderable": false,
                "render": function (data, type, row) {
                    // TODO: Update à faire en base de donnée pour ne plus avoir besoin des conditions
                    if (row.lien && row.lien.startsWith('/var/log/epuration/')) {
                        const filename = row.lien.split('/').pop();
                        const url = Routing.generate('log_download_file', { filename: filename });
                        return `<a href="${url}" class="text-decoration-none d-flex flex-row align-items-center justify-content-center gap-2">
                                        <i class='fs-3 bi bi-download'></i> Télécharger
                                    </a>`;
                    }
                    if (row.lien && row.lien.trim() !== '') {
                        return `<a href="${row.lien}" title="Lien associé" class="text-decoration-none d-flex flex-row align-items-center justify-content-center gap-2">
                        <i class='fs-3 bi bi-link-45deg'></i> Lien
                    </a>`;
                    } else if (row.message.indexOf('papyrus') !== -1 || row.message.indexOf('Kaligraf ID') !== -1) {
                        const match = /(Kaligraf ID\s*=\s*(\d+))/.exec(row.message);
                        if (match) {
                            const treatmentID = match[2];
                            const url = Routing.generate('papyrus_url', { 'action': 'resultats', 'id': treatmentID });
                            return `<a href="${url}" title="Consulter" class="text-decoration-none d-flex flex-row align-items-center justify-content-center gap-2">
                            <i class='fs-3 bi bi-plus-circle'></i> Consulter
                            </a>`
                        }
                    } else if (row.nomController === 'DGPM' && row.message.includes('Faire une saisie manuelle pour')) {
                        return `<a href="${dgpmUrl}" target="_blank" title="Notifications DGPM" class="text-decoration-none">
                        DGPM
                    </a>`
                    } else {
                        return ''
                    }
                }
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('log_export'),
                        data: JSON.stringify(
                            {filters: getFilters('list-suivi-auto-dataTable')}
                        ),
                        method: "POST",
                        success: (response) => {
                            // Si la réponse commence par le premier header attendu, on crée la fenêtre de chargement
                            if (response.startsWith('Date de traitement')) {
                                const BOM = new Uint8Array([0xEF,0xBB,0xBF]);
                                const link = document.createElement('a');
                                link.href = window.URL.createObjectURL(
                                    new Blob(
                                        [BOM, response],
                                        {type: 'text/csv'}
                                    )
                                );
                                link.download = 'traitement_auto.csv';
                                link.click();
                                window.URL.revokeObjectURL(link);

                                this.processing(false);
                            } else {
                                alert('Une erreur est survenue lors de la génération du CSV. Veuillez réessayer.');
                                this.processing(false);
                            }
                        },
                        error: (request, status, error) => {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
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
            table.buttons().container().prependTo('.dataTable-buttons')
        },

    })

    initializeFilters(table)
    initializeButtons(table)
})
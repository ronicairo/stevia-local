window.addEventListener('DOMContentLoaded', function () {
    const creanceRegroupeeId = document.getElementById('id_creance_regroupee').value ?? 'noId';
    const creanceId = document.getElementById('id_creance').value ?? 'noId';

    $('#detail-courriers-dataTable').DataTable({
        ajax: Routing.generate('detail_courriers_get_data', { creanceRegroupeeId: creanceRegroupeeId }),
        order: [[2, 'desc']],
        columns: [
            {
                'data': 'typeCourrier',
                'name': 'c.typeCourrier'
            },
            {
                'data': 'auteur',
                'name': 'c.auteur'
            },
            {
                'data': 'dateCourrier',
                'name': 'c.dateCourrier'
            },
            {
                'data': 'totalSolde',
                'name': 'c.totalSolde'
            },
            {
                'data': 'nomFichier',
                'name': 'c.nomFichier',
                'render': function (data, action, row) {
                    let actionsBtn = '';
                    if (data !== '') {
                        actionsBtn +=  '<div class="d-flex gap-2"><a href="' + data + '" target="_blank" class="btn btn-primary d-block w-50 h-100 float-start justify-content-center"><i class="fas fa-search"></i></a>'
                    } else {
                        actionsBtn += '<div class="d-flex gap-2 justify-content-end">';
                    }

                    if (
                        row.typeCourrier.startsWith('LIBRE.')
                        || (row.auteur !== null && row.auteur.toLowerCase() !== 'workflow')
                    ) {
                        actionsBtn += '<button id="delete_courrier_' + row.id + '" data-href="' + Routing.generate('detail_courriers_delete', {courrierId: row.id, creanceId: creanceId}) + '" class="btn btn-danger text-white w-50 h-100 float-end justify-content-center" data-type="' + row.typeCourrier + '" data-date="' + row.dateCourrier + '"><i class="fas fa-trash"></i></button>'
                    }

                    return actionsBtn + '</div>';
                }
            }
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing');
            $('#custom-container').append(processingDiv);

            $('button[id*="delete_courrier"]').on('click', function(e) {
                e.preventDefault();

                let element = e.currentTarget;
                confirm("Confirmez-vous la suppression du courrier " + element.dataset.type + " du " + element.dataset.date + " ? Cliquez sur OUI pour confirmer !")
                    .then(response => {
                        if (response) {
                            location.href = element.dataset.href;
                        }
                    });
            });
        }
    });
});
window.addEventListener('DOMContentLoaded', function () {
    const creanceRegroupeeId = document.getElementById('id_creance_regroupee').value ?? 'noId';

    $('#depens-dataTable').DataTable({
        ajax: Routing.generate('depens_get_data', {creanceRegroupeeId: creanceRegroupeeId }),
        columns: [
            {
                'data': 'fraisHuissier',
                'name': 'fraisHuissier'
            },
            {
                'data': 'montant',
                'name': 'montant'
            },
            {
                'data': 'odp',
                'name': 'odp'
            },
            {
                'data': 'numeroCreance',
                'name': 'numeroCreance'
            }
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing');
            $('#custom-container').append(processingDiv);
        }
    })
})
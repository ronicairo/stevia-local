window.addEventListener('DOMContentLoaded', function () {
    const creanceRegroupeeId = document.getElementById('id_creance_regroupee').value ?? 'noId';
    let columns = [
        {
            'data': 'courrier',
            'name': 'courrier'
        },
        {
            'data': 'auteur',
            'name': 'auteur'
        },
        {
            'data': 'envoyeLe',
            'name': 'envoyeLe'
        }
    ];

    $('#histo-injonction-dataTable').DataTable({
        ajax: Routing.generate('histo_injonction_get_data', { creanceRegroupeeId: creanceRegroupeeId }),
        columns: columns,
        initComplete: function () {}
    });

    $('#histo-satd-dataTable').DataTable({
        ajax: Routing.generate('histo_satd_get_data', { creanceRegroupeeId: creanceRegroupeeId }),
        columns: columns,
        initComplete: function () {}
    });
});
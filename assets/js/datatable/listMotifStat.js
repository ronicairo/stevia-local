window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-motif-stat-dataTable').DataTable({
        ajax: {
            url: Routing.generate('motif_stat_get_data'),
            data: function (d) {
                d.filters = getFilters('list-motif-stat-dataTable')
                return d;
            }
        },
        pageLength: 25,
        columns: [
            {
                "data": "libelleMotifStat",
                "name": "ms.libelle"
            },
            {
                "data": "libelleServMotifStat",
                "name": "sms.libelle",
            },
            {
                "name": "update",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('motif_stat_edit', {'id': row['idMotifStat']});
                    return `<div class="text-center"><a href="${url}" title="Modifier"><i class='fs-3 bi bi-pencil-square'></i></a></div>`;
                }
            },
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing');
            $('#custom-container').append(processingDiv);
        },
    });

    initializeFilters(table);
    initializeButtons(table);

});
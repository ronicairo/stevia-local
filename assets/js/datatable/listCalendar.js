window.addEventListener('DOMContentLoaded', function () {
    const table = $('#calendrier-dataTable').DataTable({
        ajax: {
            url: Routing.generate('calendrier_get_data'),
            data: function (d) {
                d.filters = getFilters('calendrier-dataTable')
                return d;
            }
        },
        pageLength: 25,
        columns: [
            {
                "data": "calendrierDate",
                "name": "ca.calendrierDate"
            },
            {
                "name": "update",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('calendrier_edit', {'id': row.id})
                    return `<div class="text-center"><a href="${url}" title="Modifier"><i class='fs-3 bi bi-pencil-square'></i></a></div>`
                }
            },
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing');
            $('#custom-container').append(processingDiv);
        },

    })

    initializeFilters(table)
    initializeButtons(table)
})
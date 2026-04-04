window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-uge-dataTable').DataTable({
        ajax: {
            url: Routing.generate('uge_get_data'),
            data: function (d) {
                d.filters = getFilters('list-uge-dataTable')
                return d;
            }
        },
        columns: [
            {
                "data": "numUge",
                "name": "numUge"
            },
            {
                "data": "libelle",
                "name": "libelle"
            },
            {
                "data": "email",
                "name": "email"
            },
            {
                "data": "flux",
                "name": "flux"
            },
            {
                "data": "id",
                "name": "id",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('uge_edit', {'id': row.id})
                    return `<div class="text-center"><a href="${url}" title="Modifier">`
                        + `<i class='fs-3 bi bi-pencil-square'></i></a></div>`
                }
            },
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing')
            $('#custom-container').append(processingDiv)
        },

    })

    initializeFilters(table)
    initializeButtons(table)
})
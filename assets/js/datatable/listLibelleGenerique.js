window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-lib-gen-dataTable').DataTable({
        ajax: {
            url: Routing.generate('lib_generique_get_data'),
            data: function (d) {
                d.filters = getFilters('list-lib-gen-dataTable')
                return d;
            }
        },
        columns: [
            {
                "data": "typeLib",
                "name": "tl.libelle"
            },
            {
                "data": "libelle",
                "name": "lg.libelle"
            },
            {
                "name": "update",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('lib_generique_edit', {'libelle': row.id})
                    return `<div class="text-center"><a href="${url}" title="Modifier"><i class='fs-3 bi bi-pencil-square'></i></a></div>`
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
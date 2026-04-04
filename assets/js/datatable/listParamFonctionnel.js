window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-param-fonctionnel-dataTable').DataTable({
        ajax: {
            url: Routing.generate('param_fonctionnel_get_data'),
            data: function (d) {
                d.filters = getFilters('list-param-fonctionnel-dataTable')
                return d;
            }
        },
        pageLength: 25,
        columns: [
            {
                "data": "nom",
                "name": "pf.nom"
            },
            {
                "data": "valeur",
                "name": "pf.valeur"
            },
            {
                "name": "update",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('param_fonctionnel_update', {'id': row.id})
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
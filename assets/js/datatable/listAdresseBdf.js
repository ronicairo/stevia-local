window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-adresse-bdf-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>',
        ajax: {
            url: Routing.generate('adresse_bdf_get_data'),
            data: function (d) {
                d.filters = getFilters('list-adresse-bdf-dataTable')
                return d;
            }
        },
        columns: [
            {
                "data": "adresse",
                "name": "a.adresse",
            },
            {
                "data": "complement",
                "name": "a.complement"
            },
            {
                "data": "codePostal",
                "name": "a.codePostal"
            },
            {
                "data": "commune",
                "name": "a.commune"
            },
            {
                "name": "update",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('adresse_bdf_edit', {'id': row.id})
                    return `<div class="text-center"><a href="${url}" title="Modifier"><i class='fs-3 bi bi-pencil-square'></i></a></div>`
                }
            },
        ],
    })

    initializeFilters(table)
    initializeButtons(table)
})
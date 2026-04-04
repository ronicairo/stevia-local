window.addEventListener('DOMContentLoaded', function () {
    const table = $('#dette-motif-demande-dataTable').DataTable({
        ajax: {
            url: Routing.generate('dettes_motif_demande'),
            data: function (d) {
                d.filters = getFilters('dette-motif-demande-dataTable')
                return d;
            }
        },
        columns: [
            {
                "data": "libelle",
                "name": "m.libelle"
            },
            {
                "name": "update",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('dettes_motif_demande_edit', {'id': row.id})
                    return `<div class="text-center"><a href="${url}" title="Modifier"><i class='fs-3 bi bi-pencil-square'></i></a></div>`
                }
            },
        ]
    })

    initializeFilters(table)
    initializeButtons(table)
})
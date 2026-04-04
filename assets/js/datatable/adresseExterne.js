window.addEventListener('DOMContentLoaded', function () {
    const table = $('#adresse-huissier-dataTable').DataTable({
        ajax: {
            url: Routing.generate('adresse_externe_get_data'),
            data: function (d) {
                d.filters = getFilters('adresse-huissier-dataTable')
                return d;
            }
        },
        columns: [
            { "data": "adresse", "name": "a.adresse" },
            { "data": "complement", "name": "a.complement" },
            { "data": "codePostal", "name": "a.codePostal" },
            { "data": "commune", "name": "a.commune" },
            { "data": "nomEntite", "name": "a.nomEntite" },
            { "data": "numeroTel", "name": "a.numeroTel" },
            {
                "data": "emailEntite",
                "name": "a.emailEntite",
                "render": (data) => {
                    return data ? `<a href="mailto:${data}" title="Envoyer un mail à ${data}">${data}</a>` : '';
                } },
            { "data": "codageType", "name": "type.codageType" },
            {
                "name": "update",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('adresse_externe_edit', {'id': row.id})
                    return `<div class="text-center"><a href="${url}" title="Modifier"><i class='fs-3 bi bi-pencil-square'></i></a></div>`
                }
            },
        ],

        initComplete: function () {

        },

    })

    initializeFilters(table)
    initializeButtons(table)
})

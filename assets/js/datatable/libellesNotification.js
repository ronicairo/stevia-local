window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-notification-dataTable').DataTable({
        ajax: {
            url: Routing.generate('lib_notif_get_data'),
            data: function (d) {
                d.filters = getFilters('list-notification-dataTable')
                return d;
            }
        },
        columnDefs: [{width: 150, targets: 0}, {width: 175, targets: 2}, {width: 500, targets: 3}],
        columns: [
            {
                "data": "natureCpt",
                "name": "l.natureCpt"
            },
            {
                "data": "libelleCourt",
                "name": "l.libelleCourt"
            },
            {
                "data": "catDeb",
                "name": "l.catDeb"
            },
            {
                "data": "textNotif",
                "name": "l.textNotif",
                "render": (data, type, row) => {
                    if (data.length > 150) {
                        return `
                            <div class='content-libNot' id='notif-${row.id}'>
                                <span class="trucated-text" title="${data}">${data.substring(0, 150)} ...</span>
                                <span class="full-text d-none">${data}</span>
                                <a class="read-more cursor-pointer">Tout lire</a>
                                <a class="hide-text cursor-pointer d-none">Cacher</a>
                            </div>
                                   `;
                    }
                    return data.substring(0, 150)
                }
            },
            {
                "data": "typeMasse",
                "name": "l.typeMasse",
                "render": function (data) {
                    return data ? 'Oui' : 'Non';
                }
            },
            {
                "data": "cnam",
                "name": "l.cnam",
                "render": function (data) {
                    return data ? 'Oui' : 'Non';
                }
            },
            {
                "data": "id",
                "name": "id",
                "orderable": false,
                "render": function (data, type, row) {
                    if (row.cnam === true) {
                        return `<div class="text-center text-danger" title="Modification interdite (type CNAM)">
                        <i class="fs-3 bi bi-ban"></i>
                    </div>`;
                    }
                    const url = Routing.generate('lib_notif_edit', { id: data });
                    return `<div class="text-center"><a href="${url}" title="Modifier">
                    <i class='fs-3 bi bi-pencil-square'></i></a></div>`;
                }
            }
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing');
            $('#custom-container').append(processingDiv);

            const tableElement = $('#list-notification-dataTable');

            tableElement.on('click', '.read-more', function () {
                const parent = $(this).closest('.content-libNot');
                toggleVisibility(parent, ['.full-text', '.hide-text'], ['.trucated-text', '.read-more']);
            });

            tableElement.on('click', '.hide-text', function () {
                const parent = $(this).closest('.content-libNot');
                toggleVisibility(parent, ['.trucated-text', '.read-more'], ['.full-text', '.hide-text']);
            });

        },
    });

    initializeFilters(table);
    initializeButtons(table);
});
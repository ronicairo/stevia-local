window.addEventListener('DOMContentLoaded', function () {
    const idWF = document.getElementById('idListWF').value

    $('#etape-wf-dataTable').DataTable({
        ajax: Routing.generate('etape_wf', {workflowId: idWF }),
        dom: 'ti',
        columns: [
            {
                "data": "id",
                "name": "id"
            },
            {
                "data": "delai",
                "name": "delai"
            },
            {
                "data": "seuil",
                "name": "seuil"
            },
            {
                "data": "seuilAr",
                "name": "seuilAr",
            },
            {
                "data": "libelle",
                "name": "libelle",
            },
            {
                "data": "etapeSuivante",
                "name": "nextEtape",
            },
            {
                "data": "listeWf",
                "name": "listWf",
            },
            {
                "data": "typeAction",
                "name": "typeAction",
            },
            {
                "name": "show",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('parametrage_wf', {
                        'id': row.id,
                        'idlwf': idWF,
                        'typeaction': row.codeLib,
                        'libelle': row.libelle
                    })
                    return `<div class="text-center"><a href="${url}" title="Liste des paramètres"><i class='fs-3 bi bi-gear'></i></a></div>`
                }
            },
            {
                "name": "update",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('etape_wf_edit', {
                        'workflow': idWF,
                        'etape': row.id,
                    })
                    return `<div class="text-center"><a href="${url}" title="Modifier"><i class='fs-3 bi bi-pencil-square'></i></a></div>`
                }
            },
        ],
    })

    $(function () {
        const JsVars = JSON.parse(document.getElementById('js-vars').getAttribute('data-vars'))
        const data = JSON.parse(JsVars.timelinewfjson)

        data.theme = {
            startNode: {
                radius: 10,
                fill: "#7E899D"
            },
            endNode: {
                radius: 10,
                fill: "#7E899D"
            },
            centralAxisNode: {
                height: 21,
                radius: 10,
                fill: "#04819e",
                color: "#04819e",
                inner: {
                    "stroke-width": 0,
                    stroke: "#04819e"
                },
                outer: {
                    fill: "#04819e",
                    "stroke-width": 2,
                    stroke: "#04819e"
                }
            },
            centralAxisBranchNode: {
                fill: "#F9BF3B",
                radius: 10
            }
        };

        $("#timelinezone").timeline(data);

        $('svg').attr('height', '100%');
    })
})